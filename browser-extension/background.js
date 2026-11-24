import { isOneShotCommand, SETTINGS, START_SCROLL_UP, START_SCROLL_DOWN, UPDATE_SCROLL, STOP_SCROLL } from './config.js';
import { MESSAGE_SCOPE } from './dispatcher.js';
import { ACCESS_HELP, hasSiteAccess, isCurrentTab, permittedPage } from './sites.js';

const lastStop = new Map();
chrome.tabs.onRemoved?.addListener(tabId => lastStop.delete(tabId));

function selectPanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

chrome.runtime.onInstalled.addListener(selectPanelOnClick);
chrome.runtime.onStartup.addListener(selectPanelOnClick);

async function isFocusedTarget(target) {
  const [tab, window] = await Promise.all([
    chrome.tabs.get(target.tabId), chrome.windows.get(target.windowId),
  ]);
  return window.focused && isCurrentTab(tab, target);
}

function failure(message) {
  return { ok: false, message };
}

async function dispatch({ command, target, expiresAt, issuedAt, runId }) {
  if (!Number.isInteger(target?.tabId) || !Number.isInteger(target.windowId)
      || typeof target.documentId !== 'string') return failure('The active tab or document is unavailable.');
  const url = permittedPage(target.url);
  if (!url) return failure('Chrome restricts gesture commands on this page.');
  const isScroll = [START_SCROLL_UP, START_SCROLL_DOWN, UPDATE_SCROLL].includes(command);
  if (!(isOneShotCommand(command) || isScroll || command === 'clear' || command === STOP_SCROLL)) {
    return failure('Unknown browser command.');
  }
  const options = { documentId: target.documentId };
  const injectionTarget = { tabId: target.tabId, documentIds: [target.documentId] };
  const send = async (action, extra = {}) => {
    const result = await chrome.tabs.sendMessage(target.tabId, {
      scope: MESSAGE_SCOPE, command: action, pageUrl: target.url,
      speed: SETTINGS.scrollSpeed, expiresAt, issuedAt, runId, ...extra,
    }, options);
    return typeof result?.ok === 'boolean' ? { ...result, content: true }
      : failure('The content script returned no command acknowledgment.');
  };
  if (command === STOP_SCROLL) {
    const stoppedAt = Date.now();
    lastStop.set(target.tabId, { runId, stoppedAt });
    return await send(command, { stoppedAt });
  }

  const [granted, focused] = await Promise.all([hasSiteAccess(url), isFocusedTarget(target)]);
  if (!granted) return failure(ACCESS_HELP);
  if (!focused) return failure('The active tab changed or is still loading.');
  const stale = () => {
    const stop = lastStop.get(target.tabId);
    return typeof runId !== 'string' || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > issuedAt + SETTINGS.scrollLeaseMs
      || Boolean(stop && (!stop.runId || stop.runId === runId) && issuedAt <= stop.stoppedAt);
  };
  if (isScroll && stale()) return failure('The scroll prediction expired or scrolling was cancelled.');

  // Chrome enforces host access on every probe. Inject the receiver only if absent.
  const [probe] = await chrome.scripting.executeScript({
    target: injectionTarget, func: () => {
      const listener = globalThis.handGestureControlsListener;
      return typeof listener === 'function' && chrome.runtime.onMessage.hasListener(listener);
    },
  });
  if (probe?.documentId !== target.documentId) return failure('Chrome did not reach the active document.');
  const install = async () => {
    const [injection] = await chrome.scripting.executeScript({ target: injectionTarget, files: ['content.js'] });
    if (injection?.documentId !== target.documentId) throw new Error('The active page changed during script injection.');
  };
  if (!probe.result) await install();

  async function execute(action) {
    if (isScroll && stale()) return failure('The scroll prediction expired or scrolling was cancelled.');
    try {
      return await send(action);
    } catch (error) {
      // A receiver missing after a worker or extension reload is safe to retry.
      // Other errors may follow an executed action, so leave them visible.
      if (!/Receiving end does not exist|Could not establish connection/i.test(error?.message ?? '')) throw error;
      await install();
      if (isScroll && stale()) return failure('The scroll prediction expired or scrolling was cancelled.');
      return await send(action);
    }
  }

  if (!(await isFocusedTarget(target))) return failure('The active page changed before execution.');
  if (command !== 'back') return await execute(command);

  const current = await execute('clear');
  if (!current.ok) return current;
  if (!(await isFocusedTarget(target)) || !(await hasSiteAccess(url))) {
    return { ...failure('Chrome access or the active page changed before Back.'), content: true };
  }
  try {
    await chrome.tabs.goBack(target.tabId);
    return { ok: true, message: 'Went back', content: true };
  } catch (error) {
    return { ...failure(error?.message || 'Chrome could not go back.'), content: true };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('panel.html')
      || message?.scope !== MESSAGE_SCOPE) return;
  dispatch(message).then(
    result => respond({ ...result, worker: true }),
    error => respond({ ...failure(error?.message || String(error)), worker: true }),
  );
  return true;
});
