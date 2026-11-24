import { SETTINGS, START_SCROLL_DOWN, START_SCROLL_UP, UPDATE_SCROLL } from './config.js';

export const MESSAGE_SCOPE = 'hand-gesture-controls';

export async function dispatchBrowserCommand({ command, target, issuedAt = Date.now(), scrollRun, send, report = () => {} }) {
  const scroll = command === 'scrollUp' || command === 'scrollDown';
  const expiresAt = scroll ? scrollRun?.expiresAt ?? issuedAt + SETTINGS.scrollLeaseMs : undefined;
  const wireCommand = scroll
    ? scrollRun?.update ? UPDATE_SCROLL : command === 'scrollUp' ? START_SCROLL_UP : START_SCROLL_DOWN
    : command;
  const runId = scrollRun?.id ?? (scroll ? crypto.randomUUID() : undefined);
  let trace = { command, dispatched: false, worker: false, content: false, ok: false };
  if (!target) {
    trace.message = 'No accessible active document. Check Chrome site access.';
  } else if (scroll && expiresAt <= Date.now()) {
    trace.message = 'The scroll prediction expired before dispatch.';
  } else {
    trace = { ...trace, dispatched: true, message: 'Waiting for acknowledgment…' };
    report(trace);
    let timeout;
    const waitMs = scroll ? Math.min(SETTINGS.scrollAckTimeoutMs, Math.max(0, expiresAt - Date.now())) : 3000;
    try {
      const result = await Promise.race([
        send({ scope: MESSAGE_SCOPE, command: wireCommand, target, expiresAt, issuedAt, runId }),
        new Promise((_, reject) => { timeout = setTimeout(() =>
          reject(new Error('Timed out waiting for the Chrome command acknowledgment.')), waitMs); }),
      ]);
      if (result?.worker !== true || typeof result.ok !== 'boolean') {
        trace.message = 'The service worker returned no command acknowledgment.';
      } else {
        trace = { ...trace, worker: true, content: result.content === true,
          ok: result.ok && result.content === true,
          message: result.ok && result.content !== true
            ? 'The worker returned without a content-script acknowledgment.' : result.message };
      }
    } catch (error) {
      trace.message = error?.message || String(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  report(trace);
  return trace;
}
