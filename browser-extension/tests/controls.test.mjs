import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createCommandGate } from '../command-gate.js';
import { SETTINGS, START_SCROLL_DOWN, START_SCROLL_UP, STOP_SCROLL, UPDATE_SCROLL } from '../config.js';
import { dispatchBrowserCommand } from '../dispatcher.js';
import { inspectPage, isCurrentTab, originPattern, permittedPage } from '../sites.js';

const prediction = count => ({
  gesture: 'unknown', confidence: .25, hand_detected: true,
  finger_count: count, finger_count_quality: 'reliable', hand_center: { x: .4, y: .4 },
  finger_states: Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'pinky']
    .map((name, index) => [name, index === 0 ? count === 5 : index <= count])),
});

test('a held scroll recovers after FastAPI disconnect or a sampling interruption', () => {
  const gate = createCommandGate(SETTINGS);
  assert.deepEqual([0, 75, 150, 180].map(now => gate.accept(prediction(1), now)), [null, null, null, 'scrollDown']);
  gate.suspend('FastAPI disconnected');
  assert.equal(gate.diagnostics.reason, 'FastAPI disconnected');
  assert.deepEqual([500, 575, 650, 680].map(now => gate.accept(prediction(1), now)), [null, null, null, 'scrollDown']);
});

test('diagnostic mode leaves the hold and one-shot controls in place for navigation', () => {
  const gate = createCommandGate(SETTINGS);
  assert.equal(gate.accept(prediction(1), 0, true), 'scrollDown');
  for (let now = 100; now < 800; now += 100) assert.equal(gate.accept(prediction(4), now, true), null);
  assert.equal(gate.accept(prediction(4), 800, true), 'activate');
  assert.equal(gate.accept(prediction(4), 900, true), null);
});

test('dispatcher reports actual acknowledgments and channel errors', async () => {
  const trace = [];
  const target = { tabId: 1 };
  const result = await dispatchBrowserCommand({
    command: 'highlight', target, report: state => trace.push({ ...state }),
    send: async message => {
      assert.equal(message.target, target);
      return { worker: true, content: true, ok: true, message: 'Highlighted Guide' };
    },
  });
  assert.deepEqual(trace.map(item => [item.dispatched, item.worker, item.content, item.ok]), [
    [true, false, false, false], [true, true, true, true],
  ]);
  assert.equal(result.message, 'Highlighted Guide');
  const noWorker = await dispatchBrowserCommand({ command: 'highlight', target,
    send: async () => { throw new Error('Receiving end does not exist'); } });
  assert.equal(noWorker.worker, false);
  assert.equal(noWorker.message, 'Receiving end does not exist');
  const missing = await dispatchBrowserCommand({ command: 'highlight', target, send: async () => undefined });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /no command acknowledgment/);
  const restricted = await dispatchBrowserCommand({ command: 'highlight', target: null,
    send: async () => assert.fail('Should not dispatch without a target') });
  assert.equal(restricted.dispatched, false);
});

test('dispatch bounds a stalled scroll acknowledgment by the scroll deadline', async () => {
  const now = Date.now();
  const result = await dispatchBrowserCommand({ command: 'scrollDown', target: { tabId: 1 }, issuedAt: now,
    scrollRun: { id: 'scroll', expiresAt: now + 50 }, send: () => new Promise(() => {}) });
  assert.equal(result.dispatched, true);
  assert.equal(result.worker, false);
  assert.match(result.message, /Timed out/);
});

test('the gate requires elapsed scroll dwell, bridges a brief unknown, and resets on long gaps', () => {
  const gate = createCommandGate(SETTINGS);
  const frame = (count, time) => gate.accept(prediction(count), time);
  assert.equal(frame(1, 0), null);
  assert.equal(frame(1, 70), null);
  assert.equal(frame(1, 160), null);
  assert.equal(frame(1, 180), 'scrollDown');
  assert.equal(frame(1, 290), 'scrollDown');
  assert.equal(frame(0, 360), 'idle');
  assert.equal(frame(2, 420), null);
  assert.equal(frame(2, 495), null);
  assert.equal(frame(2, 640), 'scrollUp');
  assert.equal(gate.accept({ hand_detected: false }, 700), null);
  assert.equal(frame(2, 770), 'scrollUp');
  assert.equal(frame(2, 840), 'scrollUp');
  assert.equal(frame(2, 910), 'scrollUp');
  assert.equal(gate.accept({ ...prediction(2), finger_count_quality: null }, 985), null);
  assert.equal(frame(2, 1400), null);
});

test('rejects noncanonical counts and re-arms after a stable pose change', () => {
  const gate = createCommandGate(SETTINGS);
  const unsupported = prediction(1);
  unsupported.finger_states.thumb = true;
  unsupported.finger_states.index = false;
  for (let i = 0; i < 10; i++) assert.equal(gate.accept(unsupported, i * 80), null);
  assert.equal(gate.accept(prediction(3), 900), null);
  assert.equal(gate.accept(prediction(3), 990), null);
  assert.equal(gate.accept(prediction(3), 1070), 'highlight');
  assert.equal(gate.accept(prediction(3), 1150), null);
  assert.equal(gate.accept(null, 1230), null);
  for (const time of [1300, 1400, 1500]) assert.equal(gate.accept(prediction(3), time), null);
  for (const time of [1600, 1680, 1760]) assert.equal(gate.accept(prediction(0), time), 'idle');
  assert.equal(gate.accept(prediction(3), 1840), null);
  assert.equal(gate.accept(prediction(3), 1910), null);
  assert.equal(gate.accept(prediction(3), 1980), 'highlight');
});

test('navigation requires 700 ms and fires once through tab/page changes and pause', () => {
  const gate = createCommandGate(SETTINGS);
  const hold = (count, start, end) => {
    const commands = [];
    for (let now = start; now <= end; now += 100) {
      const command = gate.accept(prediction(count), now);
      if (command) commands.push(command);
    }
    return commands;
  };
  assert.deepEqual(hold(4, 0, 600), []);
  assert.deepEqual(hold(4, 700, 1000), ['activate']);
  gate.suspend();
  assert.deepEqual(hold(4, 1100, 1900), []);
  assert.deepEqual(hold(5, 2000, 2600), []);
  assert.deepEqual(hold(5, 2700, 3000), ['back']);
  gate.suspend();
  assert.deepEqual(hold(5, 3100, 4100), []);
  gate.accept(null, 4450);
  assert.deepEqual(hold(5, 4500, 5600), ['back']);
});

test('host access uses a Chrome pattern and actions require the exact current tab and page', () => {
  for (const url of ['chrome://extensions', 'about:blank', 'file:///test', 'https://chromewebstore.google.com/',
    'https://chrome.google.com/webstore/category/extensions', 'https://creds@example.com']) {
    assert.equal(permittedPage(url), null);
  }
  const url = permittedPage('https://example.com:8443/docs');
  assert.equal(url.origin, 'https://example.com:8443');
  assert.equal(originPattern(url), 'https://example.com/*');
  const tab = { id: 5, windowId: 20, url: url.href, active: true, status: 'complete' };
  const target = { tabId: 5, windowId: 20, url: url.href };
  assert.equal(isCurrentTab(tab, target), true);
  assert.equal(isCurrentTab({ ...tab, active: false }, target), false);
  assert.equal(isCurrentTab({ ...tab, pendingUrl: 'https://example.com/' }, target), false);
  assert.equal(isCurrentTab({ ...tab, url: url.origin + '/other' }, target), false);
});

test('page status follows Chrome permission and a current top-level document', async () => {
  let granted = true;
  let injectable = true;
  let probes = 0;
  let currentUrl;
  globalThis.chrome = {
    permissions: { contains: async () => granted },
    scripting: { executeScript: async () => {
      probes += 1;
      if (!injectable) throw new Error('Blocked by Chrome');
      return [{ documentId: String(probes), result: currentUrl }];
    } },
  };
  try {
    const tab = { id: 1, windowId: 2, status: 'complete' };
    for (const url of ['https://en.wikipedia.org/wiki/Hand', 'https://www.youtube.com/', 'https://www.google.com/search?q=hands']) {
      currentUrl = url;
      const result = await inspectPage({ ...tab, url }, true);
      assert.equal(result.status, 'Accessible in Chrome');
      assert.equal(result.target.url, url);
      assert.equal(result.site, new URL(url).origin);
    }
    assert.equal(probes, 3);
    const page = { ...tab, url: currentUrl };
    assert.match((await inspectPage({ ...page, status: 'loading' }, true)).status, /finish loading/);
    assert.match((await inspectPage(tab, true)).status, /On all sites/);
    assert.match((await inspectPage({ ...tab, url: 'chrome://extensions/' }, true)).status, /restricted/);
    assert.equal(probes, 3);
    granted = false;
    assert.match((await inspectPage(page, true)).status, /withholding/);
    assert.equal(probes, 3);
    injectable = false;
    granted = true;
    const blocked = await inspectPage(page, true);
    assert.match(blocked.status, /blocked/);
    assert.equal(blocked.target, undefined);
  } finally {
    delete globalThis.chrome;
  }
});

test('the worker rejects web senders, withheld access, stale tabs and Chrome injection denial', async () => {
  const pageUrl = 'https://example.com/index';
  const panelUrl = 'chrome-extension://extension/panel.html';
  let worker;
  let granted = false;
  let active = true;
  let focused = true;
  let injectable = true;
  let installed = false;
  let installs = 0;
  let loseReceiver = false;
  const actions = [];
  globalThis.chrome = {
    runtime: {
      id: 'extension', getURL: () => panelUrl,
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener: listener => { worker = listener; } },
    },
    permissions: { contains: async () => granted },
    windows: { get: async () => ({ focused }) },
    scripting: { executeScript: async ({ target, files }) => {
      assert.deepEqual(target.documentIds, ['document']);
      if (!injectable) throw new Error('Blocked by Chrome');
      if (files) {
        installs += 1;
        installed = true;
      }
      return [{ documentId: 'document', result: installed }];
    } },
    tabs: {
      get: async () => ({ id: 1, windowId: 2, active, url: pageUrl, status: 'complete' }),
      sendMessage: async (_id, message, options) => {
        assert.equal(options.documentId, 'document');
        if (loseReceiver) {
          loseReceiver = false;
          installed = false;
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        actions.push(message.command);
        return { ok: true };
      },
      goBack: async () => { actions.push('goBack'); },
    },
  };
  try {
    await import('../background.js');
    const request = {
      scope: 'hand-gesture-controls', command: 'back',
      target: { tabId: 1, windowId: 2, url: pageUrl, documentId: 'document' },
    };
    const sender = { id: 'extension', url: panelUrl };
    const send = (overrides = {}) => new Promise(resolve =>
      assert.equal(worker({ ...request, ...overrides }, sender, resolve), true));
    for (const command of ['scrollUp', 'scrollDown']) {
      assert.match((await send({ command })).message, /Unknown browser command/);
    }
    assert.equal(worker(request, { ...sender, url: pageUrl }, () => assert.fail()), undefined);
    assert.equal((await send()).ok, false);
    granted = true;
    active = false;
    assert.equal((await send()).ok, false);
    active = true;
    focused = false;
    assert.equal((await send()).ok, false);
    focused = true;
    assert.deepEqual(actions, []);
    injectable = false;
    const issuedAt = Date.now();
    assert.equal((await send({ command: START_SCROLL_DOWN, issuedAt,
      expiresAt: issuedAt + SETTINGS.scrollLeaseMs, runId: 'test' })).ok, false);
    assert.deepEqual(actions, []);
    injectable = true;
    assert.deepEqual(await send(), { ok: true, worker: true, content: true, message: 'Went back' });
    assert.deepEqual(actions, ['clear', 'goBack']);
    assert.equal(installs, 1);
    loseReceiver = true;
    assert.equal((await send({ command: 'highlight' })).ok, true);
    assert.equal(installs, 2);
    for (const url of ['chrome://version/', 'https://chromewebstore.google.com/']) {
      assert.equal((await send({ command: START_SCROLL_DOWN, issuedAt,
        expiresAt: issuedAt + SETTINGS.scrollLeaseMs, runId: 'restricted',
        target: { ...request.target, url } })).ok, false);
    }
    assert.equal(installs, 2);
    granted = false;
    const renewalAt = Date.now();
    assert.equal((await send({ command: UPDATE_SCROLL, issuedAt: renewalAt,
      expiresAt: renewalAt + SETTINGS.scrollLeaseMs, runId: 'permission-withheld' })).ok, false);
    assert.equal((await send({ command: STOP_SCROLL })).ok, true);
    assert.deepEqual(actions, ['clear', 'goBack', 'highlight', STOP_SCROLL]);
  } finally {
    delete globalThis.chrome;
  }
});

function anchor(href, label, attributes = {}) {
  return {
    href, target: attributes.target, textContent: label, isConnected: true,
    closest: () => attributes.ancestor ?? null,
    getAttribute: name => name === 'href' ? href : attributes[name],
    hasAttribute: name => Object.hasOwn(attributes, name),
    checkVisibility: () => !attributes.hidden,
    scrollIntoView() {},
    style: {
      outline: '', outlineOffset: '', getPropertyPriority: () => '',
      setProperty(name, value) { this[name === 'outline' ? 'outline' : 'outlineOffset'] = value; },
    },
  };
}

test('content script highlights and opens safe links only, and revalidates after highlighting', async () => {
  const pageUrl = 'https://example.com/index';
  const links = [
    anchor('https://example.com/checkout', 'Purchase'),
    anchor('https://example.com/docs', 'Delete record'),
    anchor('https://example.com/help?do=delete', 'Help'),
    anchor('https://example.com/docs', 'Save', { ancestor: 'form' }),
    anchor('https://example.org/docs', 'External'),
    anchor('https://example.com/guide.zip', 'Guide', { download: '' }),
    anchor('https://example.com/invisible', 'Invisible link', { hidden: true }),
    anchor('https://example.com/guide', 'Guide'),
    anchor('https://example.com/glossary', 'Glossary'),
  ];
  let listener;
  let navigation;
  let clock = 0;
  let animation = null;
  let acknowledgment;
  const scrolled = [];
  const context = {
    chrome: { runtime: { id: 'extension', onMessage: {
      addListener: callback => { listener = callback; }, hasListener: callback => callback === listener,
    } } },
    location: { href: pageUrl, origin: 'https://example.com', assign: url => { navigation = url; } },
    document: {
      visibilityState: 'visible', addEventListener() {}, querySelectorAll: () => links,
      elementFromPoint: () => null,
    },
    window: { addEventListener() {}, scrollY: 0,
      scrollBy(options) { this.scrollY += options.top; scrolled.push(options.top, options.behavior); } },
    innerWidth: 900, innerHeight: 800, URL,
    getComputedStyle: () => ({ visibility: 'visible', pointerEvents: 'auto' }),
    setTimeout: () => 0, clearTimeout() {},
    Date: { now: () => clock },
    requestAnimationFrame: callback => { animation = callback; return 1; },
    cancelAnimationFrame: () => { animation = null; },
  };
  const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  const firstListener = listener;
  vm.runInNewContext(source, context);
  assert.equal(listener, firstListener);
  const send = (command, sender = { id: 'extension' }, url = pageUrl) => {
    acknowledgment = undefined;
    listener({ scope: 'hand-gesture-controls', command, pageUrl: url, speed: 300, expiresAt: clock + 230,
      issuedAt: clock, stoppedAt: clock, runId: command === STOP_SCROLL ? undefined : String(clock) }, sender, result => { acknowledgment = result; });
    return acknowledgment;
  };
  assert.equal(send(START_SCROLL_DOWN, { id: 'extension', tab: {} }), undefined);
  assert.equal(send(START_SCROLL_DOWN, { id: 'other' }), undefined);
  assert.equal(send(START_SCROLL_DOWN, { id: 'extension' }, 'https://example.com/stale').ok, false);
  assert.equal(send(START_SCROLL_DOWN), undefined);
  function advance(time) {
    clock = time;
    const callback = animation;
    animation = null;
    callback?.(time);
  }
  advance(0);
  advance(17);
  assert.equal(acknowledgment.ok, true);
  advance(50);
  assert.deepEqual(scrolled, [5, 'instant', 10, 'instant']);
  assert.equal(send(START_SCROLL_UP), undefined);
  advance(60);
  advance(100);
  assert.equal(acknowledgment.ok, true);
  assert.deepEqual(scrolled.slice(-2), [-12, 'instant']);
  assert.equal(send(STOP_SCROLL).ok, true);
  advance(150);
  assert.equal(scrolled.at(-2), -12);
  const nestedScroll = [];
  const nested = { scrollTop: 50, scrollHeight: 1000, clientHeight: 500,
    scrollBy(options) { this.scrollTop += options.top; nestedScroll.push(options.top, options.behavior); } };
  context.document.elementFromPoint = () => nested;
  context.getComputedStyle = () => ({ overflowY: 'auto', visibility: 'visible', pointerEvents: 'auto' });
  assert.equal(send(START_SCROLL_DOWN), undefined);
  advance(150);
  advance(180);
  assert.equal(acknowledgment.ok, true);
  advance(390);
  assert.deepEqual(nestedScroll, [9, 'instant']);
  assert.equal(animation, null);
  assert.equal(send('activate').ok, false);
  assert.equal(send('highlight').message, 'Highlighted Guide');
  assert.ok(links[7].style.outline);
  links[7].href = 'https://example.com/checkout';
  assert.equal(send('activate').ok, false);
  assert.equal(links[7].style.outline, '');
  assert.equal(navigation, undefined);
  assert.equal(send('highlight').message, 'Highlighted Glossary');
  assert.equal(send('activate').ok, true);
  assert.equal(navigation, 'https://example.com/glossary');
});
