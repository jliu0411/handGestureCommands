import { COMMAND_LABELS, COUNT_COMMANDS, FINGER_NAMES, SETTINGS, STOP_SCROLL, UPDATE_SCROLL } from './config.js';
import { checkGestureBackend, findGestureBackend } from './backend-client.js';
import { createCommandGate, readFingerPose } from './command-gate.js';
import { dispatchBrowserCommand } from './dispatcher.js';
import { createRecognitionDiagnostics, deliverySummary } from './recognition-diagnostics.js';
import { createScrollPolicy } from './scroll-policy.js';
import { inspectPage } from './sites.js';

const elements = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), element => [element.id, element]));
const video = elements.preview;
const canvas = document.createElement('canvas');
const frameContext = canvas.getContext('2d', { willReadFrequently: true });
const gate = createCommandGate(SETTINGS);
const scrollPolicy = createScrollPolicy(SETTINGS);
const diagnostics = createRecognitionDiagnostics();

const windowId = (await chrome.windows.getCurrent()).id;
let activeTabId;
let target = null;
let pageEpoch = 0;
let siteCheck = 0;

let session = null;
let paused = false;
let scrolling = null;
let lastValidPoseAt = null;
let leaseExpired = false;
let pendingCommand = null;
let dispatchRevision = 0;
const testButtons = Array.from(document.querySelectorAll('[data-test-command]'));

function endScrollRun(status, reason, reportReason = reason) {
  const previous = scrolling;
  scrolling = null;
  elements.scrolling.textContent = status;
  if (previous || reason) elements['scroll-reason'].textContent = reason ?? status;
  if (previous) diagnostics.interrupt(reportReason ?? status, performance.now());
  return previous ? sendCommand(STOP_SCROLL, previous.page, undefined, false, { id: previous.id })
    : Promise.resolve();
}

function stopScrolling(status = 'Idle', reason, reportReason) {
  scrollPolicy.reset();
  return endScrollRun(status, reason, reportReason);
}

function showScrollStatus() {
  const now = performance.now();
  if (scrolling && now >= Math.min(scrolling.wanted.expiresAt, scrolling.acknowledgedUntil ?? Infinity)) {
    leaseExpired = true;
    const reason = scrolling.expiryReason ?? (now < scrolling.wanted.expiresAt
      ? 'No acknowledged scroll renewal' : scrolling.wanted.source === 'Valid pose'
        ? 'No fresh prediction' : scrolling.wanted.source);
    const message = 'Scroll lease expired · ' + reason;
    gate.suspend(message);
    stopScrolling('Idle', message);
    displayGate(null, message);
  }
  elements['scroll-direction'].textContent = scrolling?.direction === 'scrollUp' ? 'Up'
    : scrolling ? 'Down' : '—';
  elements['scroll-running'].textContent = scrolling?.acknowledged ? 'Yes' : 'No';
  elements['pose-age'].textContent = lastValidPoseAt === null ? '—' : Math.round(now - lastValidPoseAt) + ' ms ago';
  elements['scroll-lease'].textContent = scrolling
    ? Math.max(0, Math.ceil(Math.min(scrolling.wanted.expiresAt, scrolling.acknowledgedUntil ?? Infinity) - now))
      + ' ms left · ' + scrolling.wanted.source
    : leaseExpired ? 'Expired' : 'Inactive';
}

const scrollStatusTimer = setInterval(showScrollStatus, 80);

function resetPage() {
  pageEpoch += 1;
  stopScrolling(!session ? 'Stopped' : paused ? 'Paused' : 'Idle', 'Active page changed');
  target = null;
  gate.suspend();
  displayGate(null, 'Active page changed');
  elements.command.textContent = '—';
  elements['command-feedback'].textContent = '';
}

async function refreshSite() {
  const check = ++siteCheck;
  try {
    const [[tab], window] = await Promise.all([
      chrome.tabs.query({ active: true, windowId }), chrome.windows.get(windowId),
    ]);
    if (check !== siteCheck) return;
    activeTabId = tab?.id;
    const page = await inspectPage(tab, window.focused);
    if (check !== siteCheck) return;
    if (target && (!page.target || target.tabId !== page.target.tabId
        || target.documentId !== page.target.documentId || target.url !== page.target.url)) resetPage();
    target = page.target ?? null;
    if (elements.site.textContent !== page.site) elements.site.textContent = page.site;
    if (elements['site-access'].textContent !== page.status) elements['site-access'].textContent = page.status;
  } catch {
    if (check !== siteCheck) return;
    resetPage();
    elements.site.textContent = '—';
    elements['site-access'].textContent = 'Chrome could not read the active tab. Switch tabs to retry.';
  }
}

function updatePage() {
  resetPage();
  elements['site-access'].textContent = 'Checking active tab';
  void refreshSite();
}

chrome.tabs.onActivated.addListener(info => {
  if (info.windowId === windowId) {
    activeTabId = info.tabId;
    updatePage();
  }
});
chrome.windows.onFocusChanged.addListener(updatePage);
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tabId !== activeTabId && !(tab.windowId === windowId && tab.active)) return;
  if (change.url || change.status === 'loading' || change.status === 'unloaded') updatePage();
  else if (change.status === 'complete') void refreshSite();
});
chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (info.windowId === windowId && tabId === activeTabId) updatePage();
});
chrome.tabs.onReplaced.addListener((_addedId, removedId) => {
  if (removedId === activeTabId) updatePage();
});
chrome.permissions.onAdded.addListener(updatePage);
chrome.permissions.onRemoved.addListener(updatePage);
// Chrome can reveal a withheld URL without a navigation event.
const siteRetry = setInterval(() => { if (!target) void refreshSite(); }, 1500);

async function request(api, path, options = {}, sessionSignal) {
  const timeout = AbortSignal.timeout(7000);
  const signal = sessionSignal ? AbortSignal.any([timeout, sessionSignal]) : timeout;
  const response = await fetch(api + path, { ...options, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('FastAPI returned HTTP ' + response.status);
  return response.json();
}

function showConnection(backend) {
  elements.backend.textContent = 'FastAPI connected · ' + new URL(backend.api).port;
}

function predictionQuality(prediction, pose) {
  return pose ? (pose.canonical ? 'Reliable' : 'Unsupported finger combination')
    : prediction?.hand_detected ? 'Uncertain' : prediction ? 'No hand' : '—';
}

function displayPrediction(prediction, pose = readFingerPose(prediction)) {
  elements['finger-count'].textContent = Number.isInteger(prediction?.finger_count) ? String(prediction.finger_count) : '—';
  elements.fingers.textContent = pose
    ? FINGER_NAMES.filter(name => pose.states[name]).join(', ') || 'None' : '—';
  elements.quality.textContent = predictionQuality(prediction, pose);
  elements['classifier-confidence'].textContent = Number.isFinite(prediction?.confidence)
    ? Math.round(prediction.confidence * 100) + '%' : '—';
}

function record(message) {
  const row = document.createElement('li');
  const time = document.createElement('time');
  const now = new Date();
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString();
  const label = document.createElement('span');
  label.textContent = message;
  row.append(time, label);
  elements.history.prepend(row);
  if (elements.history.children.length > 20) elements.history.lastElementChild.remove();
  elements['empty-history'].hidden = true;
}

function sendCommand(command, page = target, issuedAt, diagnostic = false, scrollRun) {
  const revision = diagnostic ? ++dispatchRevision : dispatchRevision;
  const update = scrollRun?.update === true;
  return dispatchBrowserCommand({
    command, target: page, issuedAt, scrollRun, send: message => chrome.runtime.sendMessage(message),
    report: trace => {
      if (!diagnostic || revision !== dispatchRevision) return;
      elements['debug-command'].textContent = COMMAND_LABELS[trace.command] ?? trace.command;
      for (const [field, value] of Object.entries({
        dispatched: trace.dispatched, worker: trace.worker, content: trace.content, executed: trace.ok,
      })) elements['debug-' + field].textContent = value ? 'Yes' : 'No';
      elements['debug-result'].textContent = trace.message ?? '—';
    },
  }).then(trace => {
    if (command !== 'clear') diagnostics.command(update ? { ...trace, command: UPDATE_SCROLL } : trace,
      Boolean(scrollRun) && !update && command !== STOP_SCROLL, performance.now());
    if (update && scrolling?.id === scrollRun.id) {
      elements['renewal-result'].textContent = trace.ok ? 'Acknowledged' : deliverySummary(trace);
    }
    return trace;
  });
}

function clearSelection() {
  void sendCommand('clear').catch(() => {});
}

function setPaused(value, clear = true) {
  paused = value;
  pageEpoch += 1;
  gate.suspend();
  const stopped = stopScrolling(paused ? 'Paused' : 'Idle', paused ? 'Commands paused' : undefined);
  displayGate(null, paused ? 'Commands paused' : 'Waiting for a stable pose');
  elements.state.textContent = paused ? 'Paused' : 'Active';
  elements.pause.textContent = paused ? 'Resume commands' : 'Pause commands';
  elements.command.textContent = paused ? 'Paused commands' : 'Resumed commands';
  elements['command-feedback'].textContent = '';
  if (paused && clear) clearSelection();
  record(elements.command.textContent);
  return stopped;
}

function endSession(cameraStatus = 'Camera off') {
  const active = session;
  session = null;
  if (active) {
    clearTimeout(active.timer);
    active.controller.abort();
    active.stream?.getTracks().forEach(track => track.stop());
  }
  video.srcObject = null;
  clearSelection();
  gate.reset();
  stopScrolling('Stopped', 'Recognition stopped');
  lastValidPoseAt = null;
  displayGate(null, 'Recognition stopped');
  elements.sampling.textContent = '—';

  paused = false;
  elements.start.disabled = false;
  elements.stop.disabled = true;
  elements.pause.disabled = true;
  elements.pause.textContent = 'Pause commands';
  elements.state.textContent = 'Stopped';
  elements.camera.textContent = cameraStatus;
  elements.command.textContent = '—';
  elements['command-feedback'].textContent = '';
  displayPrediction(null);
}

function captureFrame() {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  frameContext.drawImage(video, 0, 0, width, height);
  // Canvas.toBlob can wait for a renderer idle task. Encode the small frame
  // immediately so a busy browser cannot stall the entire prediction loop there.
  const jpeg = atob(canvas.toDataURL('image/jpeg', 0.78).slice('data:image/jpeg;base64,'.length));
  return Uint8Array.from(jpeg, byte => byte.charCodeAt(0));
}

function updateSampling(active, receivedAt, apiLatency, captureLatency) {
  active.samples.push({ at: receivedAt, apiLatency, captureLatency });
  while (active.samples.length > 2 && active.samples[0].at < receivedAt - 2000) active.samples.shift();
  const elapsed = receivedAt - active.samples[0].at;
  if (elapsed <= 0 || receivedAt - active.lastReadout < 500) return;
  const intervalMs = elapsed / (active.samples.length - 1);
  const rate = 1000 / intervalMs;
  let peakGap = 0;
  let apiTotal = 0;
  let captureTotal = 0;
  for (const [index, sample] of active.samples.entries()) {
    apiTotal += sample.apiLatency;
    captureTotal += sample.captureLatency;
    if (index > 0) peakGap = Math.max(peakGap, sample.at - active.samples[index - 1].at);
  }
  const apiMs = apiTotal / active.samples.length;
  const captureMs = captureTotal / active.samples.length;
  elements.sampling.textContent = `${rate.toFixed(1)} Hz · ${Math.round(peakGap)} ms peak gap · ${Math.round(captureMs)} ms JPEG · ${Math.round(apiMs)} ms API`;
  diagnostics.sampling({ rate, intervalMs, peakGap, apiMs, captureMs }, receivedAt);
  active.lastReadout = receivedAt;
}

function displayGate(prediction, reason, intent = scrolling?.wanted, pose = readFingerPose(prediction)) {
  const now = performance.now();
  const info = gate.diagnostics;
  const count = Number.isInteger(prediction?.finger_count) ? prediction.finger_count : info.count ?? null;
  const mapped = info.mapped ?? COUNT_COMMANDS[count];
  const stable = intent?.count ?? (reason ? null : info.stableCount ?? null);
  const gateResult = reason ?? (info.accepted ? 'Accepted' : info.reason ?? 'Waiting');
  elements['stable-count'].textContent = stable ?? '—';
  elements['debug-count'].textContent = Number.isInteger(count) ? String(count) : '—';
  elements['debug-mapped'].textContent = COMMAND_LABELS[mapped] ?? '—';
  elements['debug-stability'].textContent = reason ? 'Waiting' : info.stability ?? '—';
  elements['debug-gate'].textContent = gateResult;
  diagnostics.observe({ raw: count, stable, pending: reason ? null : info.pendingScrollCount,
    quality: predictionQuality(prediction, pose), confidence: prediction?.confidence,
    validPoseAge: lastValidPoseAt === null ? null : Math.round(now - lastValidPoseAt),
    reason: gateResult, scroll: intent?.source ?? (session ? 'Idle' : 'Stopped'),
  }, now);
}

function flushScroll(run) {
  if (scrolling !== run || run.pending || run.wanted === run.sent) return Promise.resolve();
  const intent = run.wanted;
  if (intent.expiresAt <= performance.now()) {
    showScrollStatus();
    return Promise.resolve();
  }
  const issuedAt = Math.floor(performance.timeOrigin + intent.eventAt);
  const expiresAt = Math.min(issuedAt + SETTINGS.scrollLeaseMs, Math.floor(performance.timeOrigin + intent.expiresAt));
  const starting = !run.acknowledged;
  run.sent = intent;
  run.pending = true;
  return sendCommand(run.direction, run.page, issuedAt, starting, {
    id: run.id, update: !starting, expiresAt,
  }).then(result => {
    if (scrolling !== run) return;
    if (result.ok) {
      run.acknowledged = true;
      run.acknowledgedUntil = intent.expiresAt;
      elements.scrolling.textContent = run.direction === 'scrollUp' ? 'Scrolling up' : 'Scrolling down';
      if (starting) {
        record(result.message);
        elements['scroll-reason'].textContent = intent.source;
      }
    } else if (starting || result.worker || !result.dispatched) {
      const failure = deliverySummary(result);
      gate.suspend(failure);
      stopScrolling('Idle', result.message, failure);
      displayGate(null, failure);
      void refreshSite();
    }
    elements['command-feedback'].textContent = result.ok ? '' : result.message ?? '';
    showScrollStatus();
  }).finally(() => {
    run.pending = false;
    if (scrolling === run && run.wanted !== run.sent) void flushScroll(run);
  });
}

function syncScroll(intent, reason = 'Pose changed') {
  if (scrolling && scrolling.direction !== intent?.direction) {
    leaseExpired = performance.now() >= scrolling.wanted.expiresAt;
    endScrollRun('Idle', reason);
  }
  if (!intent) return Promise.resolve();
  if (!scrolling) {
    scrolling = { id: crypto.randomUUID(), direction: intent.direction, page: target };
    leaseExpired = false;
    elements.scrolling.textContent = 'Starting scroll';
    elements['renewal-result'].textContent = '—';
  }
  scrolling.wanted = intent;
  scrolling.expiryReason = null;
  return flushScroll(scrolling);
}

function executeGesture(command, active, epoch, capturedAt) {
  if (pendingCommand) return;
  const page = target;
  pendingCommand = sendCommand(command, page, performance.timeOrigin + capturedAt, true)
    .then(result => {
      if (session !== active) return;
      if (result.ok) record(result.message);
      if (epoch !== pageEpoch) return;
      if (!result.ok) void refreshSite();
      elements['command-feedback'].textContent = result.ok ? '' : result.message ?? '';
    }).finally(() => { pendingCommand = null; });
}

async function sample(active) {
  const epoch = pageEpoch;
  const started = performance.now();
  let interval = SETTINGS.frameIntervalMs;
  try {
    if (!active.connected) {
      const backend = await checkGestureBackend(request, active.backend.api, active.controller.signal);
      if (!backend?.fingerCountAvailable) throw new Error('Finger-count API is unavailable');
      active.backend = backend;
    }
    if (session !== active) return;
    active.connected = true;
    const capturedAt = performance.now();
    const frameNumber = video.getVideoPlaybackQuality().totalVideoFrames;
    if (frameNumber > 0 && active.frameNumber === frameNumber) {
      if (capturedAt - active.lastCaptureAt > SETTINGS.maxScrollSampleGapMs) {
        gate.suspend();
        displayGate(null, 'Waiting for a fresh camera frame');
        displayPrediction(null);
        elements.sampling.textContent = '—';
      }
      return;
    }
    active.frameNumber = frameNumber;
    active.lastCaptureAt = capturedAt;
    let frame;
    try {
      frame = captureFrame();
    } catch {
      gate.suspend();
      displayGate(null, 'Could not encode the camera frame');
      return;
    }
    if (!frame) {
      displayGate(null, 'Waiting for camera frames');
      return;
    }
    const sentAt = performance.now();
    const prediction = await request(active.backend.api, '/predict', {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: frame,
    }, active.controller.signal);
    if (session !== active) return;
    const receivedAt = performance.now();
    updateSampling(active, receivedAt, receivedAt - sentAt, sentAt - capturedAt);
    showConnection(active.backend);
    const pose = readFingerPose(prediction);
    displayPrediction(prediction, pose);
    const age = receivedAt - capturedAt;
    if (pose?.canonical && age < SETTINGS.maxScrollSampleGapMs) lastValidPoseAt = capturedAt;
    if (epoch !== pageEpoch) return;
    if (paused || !target) {
      displayGate(prediction, paused ? 'Commands paused' : 'No accessible active page');
      return;
    }
    if (age >= SETTINGS.maxScrollSampleGapMs) {
      gate.suspend();
      displayGate(prediction, 'The prediction is stale');
      return;
    }
    showScrollStatus();
    const staleForNavigation = Number.isInteger(pose?.count) && pose.count >= 3 && age >= SETTINGS.maxSampleGapMs;
    let command = null;
    if (staleForNavigation) {
      gate.suspend();
    } else {
      command = gate.accept(prediction, capturedAt, elements['bypass-stability'].checked, !pendingCommand);
    }
    const intent = scrollPolicy.accept(pose, prediction.hand_detected, command, receivedAt, gate.diagnostics.stableCount);
    void syncScroll(intent, scrollPolicy.stopReason ?? 'Tracking grace expired');
    displayGate(prediction, staleForNavigation ? 'The prediction is stale for link or Back commands' : undefined, intent, pose);
    if (intent) {
      elements.command.textContent = COMMAND_LABELS[intent.direction];
      return;
    }
    if (!command || command === 'idle') {
      elements.command.textContent = command === 'idle' ? COMMAND_LABELS.idle : '—';
      return;
    }

    elements.command.textContent = COMMAND_LABELS[command];
    if (command !== 'scrollUp' && command !== 'scrollDown') executeGesture(command, active, epoch, capturedAt);
  } catch {
    if (session !== active) return;
    active.connected = false;
    elements.backend.textContent = 'FastAPI unavailable · retrying';
    displayPrediction(null);
    gate.suspend();
    displayGate(null, 'FastAPI disconnected');
    if (scrolling) {
      scrolling.wanted = scrolling.sent ?? scrolling.wanted;
      scrolling.expiryReason = 'FastAPI disconnected';
    }
    active.samples.length = 0;
    elements.sampling.textContent = '—';
    interval = 1200;
  } finally {
    if (session === active) {
      active.timer = setTimeout(() => void sample(active), Math.max(0, interval - (performance.now() - started)));
    }
  }
}

elements.start.addEventListener('click', async () => {
  if (session) return;
  const active = { controller: new AbortController(), samples: [], lastReadout: -Infinity };
  session = active;
  elements.start.disabled = true;
  elements.stop.disabled = false;
  elements['camera-access'].hidden = true;
  elements.state.textContent = 'Starting';
  elements.backend.textContent = 'Checking FastAPI';
  try {
    active.backend = await findGestureBackend(request, active.controller.signal);
    if (session !== active) return;
    active.connected = true;
    showConnection(active.backend);
  } catch (error) {
    if (session !== active) return;
    elements.backend.textContent = error.message;
    endSession();
    return;
  }
  try {
    elements.camera.textContent = 'Waiting for camera permission…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
    });
    if (session !== active) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    active.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (session === active) endSession('Camera disconnected. Restart recognition to retry.');
      });
    }
    video.srcObject = stream;
    await video.play();
    if (session !== active) return;
    elements.camera.textContent = 'Camera on';
    elements.state.textContent = 'Active';
    elements.scrolling.textContent = 'Idle';
    elements.pause.disabled = false;
    void sample(active);
  } catch (error) {
    if (session !== active) return;
    const denied = ['NotAllowedError', 'SecurityError'].includes(error.name);
    endSession(denied ? 'Camera access was denied. Grant access in a tab, then try again.'
      : 'Chrome could not open the camera.');
    elements['camera-access'].hidden = !denied;
  }
});

elements.stop.addEventListener('click', () => endSession());
elements.pause.addEventListener('click', () => setPaused(!paused));
elements['record-diagnostics'].addEventListener('change', event => {
  const enabled = event.target.checked;
  diagnostics.setEnabled(enabled, performance.now());
  elements['copy-diagnostics'].disabled = !enabled;
  elements['diagnostic-report'].hidden = true;
  elements['diagnostic-report'].value = '';
  elements['copy-status'].textContent = '';
});
elements['copy-diagnostics'].addEventListener('click', async () => {
  const report = diagnostics.report(chrome.runtime.getManifest().version, performance.now(), lastValidPoseAt);
  if (!report) return;
  const field = elements['diagnostic-report'];
  field.value = report;
  field.hidden = false;
  try {
    await navigator.clipboard.writeText(report);
    elements['copy-status'].textContent = 'Diagnostic report copied.';
  } catch {
    field.focus();
    field.select();
    elements['copy-status'].textContent = 'Select and copy the diagnostic report.';
  }
});
for (const button of testButtons) {
  button.addEventListener('click', async () => {
    for (const item of testButtons) item.disabled = true;
    try {
      await (session && !paused ? setPaused(true, false) : stopScrolling());
      await pendingCommand;
      const command = button.dataset.testCommand;
      if (target && (command === 'scrollUp' || command === 'scrollDown')) {
        const eventAt = performance.now();
        await syncScroll({ direction: command, eventAt, expiresAt: eventAt + SETTINGS.scrollLeaseMs,
          source: 'Manual scroll test' });
      } else {
        const result = await sendCommand(command, target, Date.now(), true);
        if (result.ok) record(result.message);
      }
    } finally {
      for (const item of testButtons) item.disabled = false;
    }
  });
}
elements['camera-access'].addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('camera.html'), windowId });
});
window.addEventListener('pagehide', () => {
  clearInterval(siteRetry);
  clearInterval(scrollStatusTimer);
  endSession();
});
chrome.sidePanel.onClosed?.addListener(info => {
  if (info.windowId === windowId) endSession();
});

elements.speed.textContent = SETTINGS.scrollSpeed + ' px/sec';
const poses = ['Closed fist', 'Index', 'Index + middle', 'Index + middle + ring',
  'Four fingers, thumb folded', 'Open palm'];
for (const [count, command] of COUNT_COMMANDS.entries()) {
  const label = document.createElement('dt');
  label.textContent = count + ' · ' + poses[count];
  const item = document.createElement('dd');
  item.textContent = COMMAND_LABELS[command];
  elements.mappings.append(label, item);
}
updatePage();
void findGestureBackend(request).then(backend => {
  if (!session) showConnection(backend);
}).catch(error => {
  if (!session) elements.backend.textContent = error.message;
});
