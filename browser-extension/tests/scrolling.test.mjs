import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createCommandGate, readFingerPose } from '../command-gate.js';
import { SETTINGS, START_SCROLL_DOWN, START_SCROLL_UP, UPDATE_SCROLL, STOP_SCROLL } from '../config.js';
import { createScrollPolicy } from '../scroll-policy.js';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const names = ['thumb', 'index', 'middle', 'ring', 'pinky'];
function prediction(count) {
  return {
    hand_detected: true, hand_center: { x: .5, y: .5 }, finger_count: count,
    finger_count_quality: 'reliable', finger_states: Object.fromEntries(names.map((name, index) =>
      [name, name === 'thumb' ? count === 5 : index <= count])),
  };
}

function harness() {
  const url = 'https://example.com/scroll';
  const frames = new Map();
  const events = new Map();
  const windowEvents = new Map();
  const moves = [];
  let nextId = 0;
  let time = 0;
  let nextFrame = 0;
  let position = 1000;
  let listener;
  let maxLoops = 0;
  const context = {
    chrome: { runtime: { id: 'extension', onMessage: { addListener: callback => { listener = callback; } } } },
    location: { href: url },
    document: { visibilityState: 'visible', addEventListener: (name, cb) => events.set(name, cb),
      elementFromPoint: () => null },
    window: {
      addEventListener: (name, cb) => windowEvents.set(name, cb),
      get scrollY() { return position; },
      scrollBy({ top, behavior }) {
        assert.equal(behavior, 'instant');
        position += top;
        moves.push({ at: time, top });
      },
    },
    innerWidth: 900, innerHeight: 800,
    Date: { now: () => time },
    requestAnimationFrame(callback) {
      frames.set(++nextId, callback);
      maxLoops = Math.max(maxLoops, frames.size);
      return nextId;
    },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: () => 1, clearTimeout() {},
  };
  vm.runInNewContext(source, context);
  const send = (command, runId, expiresAt, issuedAt = time) => {
    const acknowledgments = [];
    listener({
      scope: 'hand-gesture-controls', pageUrl: url, command, runId, expiresAt,
      issuedAt, stoppedAt: time, speed: SETTINGS.scrollSpeed,
    }, { id: 'extension' }, acknowledgment => acknowledgments.push(acknowledgment));
    return acknowledgments;
  };
  return {
    moves, send,
    get position() { return position; },
    get maxLoops() { return maxLoops; },
    advance(until) {
      for (; nextFrame <= until + 1e-8; nextFrame += 1000 / 60) {
        time = nextFrame;
        for (const [id, callback] of [...frames]) {
          frames.delete(id);
          callback(time);
        }
      }
      time = until;
    },
    hide() {
      context.document.hidden = true;
      context.document.visibilityState = 'hidden';
      events.get('visibilitychange')();
    },
    leave() { windowEvents.get('pagehide')(); },
  };
}

for (const [hz, count] of [[3, 1], [5, 2], [10, 1], [15, 2]]) {
  test(`scrolls ${count === 1 ? 'down' : 'up'} for 10 seconds at ${hz} Hz through isolated dropouts and wrong counts`, () => {
    const tab = harness();
    const gate = createCommandGate(SETTINGS);
    const policy = createScrollPolicy(SETTINGS);
    let previous = null;
    let starts = 0;
    const observations = hz * 11;
    const latency = 900 / hz;
    for (let sample = 0; sample <= observations; sample++) {
      const capturedAt = sample * 1000 / hz + (sample % 3) * 5;
      const receivedAt = capturedAt + latency;
      tab.advance(receivedAt);
      // The fractional timing variation stays under the 350 ms gap allowance at 3 Hz.
      const frame = sample === hz * 2 ? { hand_detected: true } : sample === hz * 4 ? null
        : prediction(sample === hz * 6 ? 3 - count : sample === hz * 8 ? 3 : count);
      const command = gate.accept(frame, capturedAt);
      const state = policy.accept(readFingerPose(frame), frame?.hand_detected, command, receivedAt,
        gate.diagnostics.stableCount);
      if (state && state !== previous) {
        const wireCommand = previous ? UPDATE_SCROLL : count === 1 ? START_SCROLL_DOWN : START_SCROLL_UP;
        if (!previous) starts += 1;
        tab.send(wireCommand, 'same-run', state.expiresAt, state.eventAt);
      }
      if (!state && previous) tab.send(STOP_SCROLL, 'same-run');
      previous = state;
    }
    assert.equal(starts, 1);
    assert.equal(tab.maxLoops, 1);
    const initial = tab.moves[0];
    const last = tab.moves.at(-1);
    assert.ok(last.at - initial.at >= 10000, 'Scroll runs for at least ten seconds.');
    assert.ok(tab.moves.slice(1).every((move, index) => move.at - tab.moves[index].at < 17),
      'No animation frames were missed after scrolling started.');
    const traveled = tab.moves.slice(1).reduce((total, move) => total + move.top, 0);
    assert.ok(Math.abs(traveled / (last.at - initial.at) * 1000 - (count === 1 ? 1 : -1) * SETTINGS.scrollSpeed) < 2);
  });
}

test('confirmed direction changes switch and the first reliable fist stops immediately', () => {
  const gate = createCommandGate(SETTINGS);
  const policy = createScrollPolicy(SETTINGS);
  const feed = (count, time) => {
    const frame = prediction(count);
    return policy.accept(readFingerPose(frame), true, gate.accept(frame, time), time);
  };
  assert.equal(feed(1, 0), null);
  assert.equal(feed(1, 80), null);
  assert.equal(feed(1, 180).direction, 'scrollDown');
  assert.equal(feed(2, 240).direction, 'scrollDown');
  assert.equal(feed(2, 320).direction, 'scrollDown');
  assert.equal(feed(2, 420).direction, 'scrollUp');
  assert.equal(policy.stopReason, 'Confirmed direction change');
  assert.equal(feed(0, 480), null);
  assert.equal(policy.stopReason, 'Closed fist');
});

test('wrong counts and unknowns share one bounded transition deadline', () => {
  const policy = createScrollPolicy(SETTINGS);
  const down = readFingerPose(prediction(1));
  const up = readFingerPose(prediction(2));
  policy.accept(down, true, 'scrollDown', 0);
  const grace = policy.accept(up, true, null, 80);
  assert.equal(grace.expiresAt, 530);
  assert.equal(policy.accept(null, true, null, 200), grace);
  assert.equal(policy.accept(up, true, null, 420), grace);
  assert.equal(policy.accept(null, false, null, 530), null);
});

test('a confirmed one-shot link pose releases scroll without changing the link hold', () => {
  const gate = createCommandGate(SETTINGS);
  const policy = createScrollPolicy(SETTINGS);
  const feed = (count, time) => {
    const frame = prediction(count);
    const command = gate.accept(frame, time);
    return [command, policy.accept(readFingerPose(frame), true, command, time, gate.diagnostics.stableCount)?.direction];
  };
  feed(1, 0);
  assert.deepEqual(feed(1, 180), ['scrollDown', 'scrollDown']);
  assert.deepEqual(feed(4, 250), [null, 'scrollDown']);
  assert.deepEqual(feed(4, 350), [null, 'scrollDown']);
  assert.deepEqual(feed(4, 450), [null, undefined]);
  for (let time = 550; time < 950; time += 100) assert.deepEqual(feed(4, time), [null, undefined]);
  assert.deepEqual(feed(4, 950), ['activate', undefined]);
  assert.deepEqual(feed(4, 1050), [null, undefined]);
});

test('upward scrolling renews in place and a previous run cannot stop or restart it', () => {
  const tab = harness();
  tab.send(START_SCROLL_DOWN, 'down', 600);
  tab.advance(100);
  tab.send(START_SCROLL_UP, 'up', 700);
  tab.send(STOP_SCROLL, 'down');
  tab.advance(240);
  tab.send(UPDATE_SCROLL, 'up', 840);
  assert.equal(tab.send(START_SCROLL_DOWN, 'down', 600, 0)[0].ok, false);
  tab.advance(700);
  assert.ok(tab.moves.filter(move => move.at > 130).every(move => move.top < 0));
  assert.equal(tab.maxLoops, 1);
  tab.send(STOP_SCROLL, 'up');
  const stopped = tab.position;
  tab.advance(850);
  assert.equal(tab.position, stopped);
});

test('sustained tracking loss expires the grace and cannot be renewed by further misses', () => {
  const tab = harness();
  const policy = createScrollPolicy(SETTINGS);
  const valid = readFingerPose(prediction(1));
  let intent = policy.accept(valid, true, 'scrollDown', 0);
  tab.send(START_SCROLL_DOWN, 'down', intent.expiresAt);
  tab.advance(200);
  intent = policy.accept(null, false, null, 200);
  tab.send(UPDATE_SCROLL, 'down', intent.expiresAt);
  assert.equal(intent.expiresAt, 550);
  assert.equal(policy.accept(null, false, null, 450), intent);
  tab.advance(550);
  const stopped = tab.position;
  tab.advance(800);
  assert.equal(tab.position, stopped);
  assert.equal(policy.accept(null, false, null, 800), null);
});

for (const [name, stop] of [
  ['disconnect or panel loss without a stop message', tab => tab.advance(600)],
  ['Stop Recognition', tab => tab.send(STOP_SCROLL, 'down')],
  ['switching tabs', tab => tab.hide()],
  ['page closing', tab => tab.leave()],
]) {
  test(`ends the only animation loop after ${name}`, () => {
    const tab = harness();
    tab.send(START_SCROLL_DOWN, 'down', 600);
    tab.advance(200);
    assert.ok(tab.position > 1000);
    stop(tab);
    const stopped = tab.position;
    tab.advance(1000);
    assert.equal(tab.position, stopped);
    assert.equal(tab.send(UPDATE_SCROLL, 'down', 1600)[0].ok, false);
    assert.equal(tab.maxLoops, 1);
  });
}
