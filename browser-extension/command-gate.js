import { COUNT_COMMANDS, FINGER_NAMES } from './config.js';

export function readFingerPose(prediction) {
  const { finger_count: count, finger_states: states, hand_center: center } = prediction ?? {};
  if (prediction?.hand_detected !== true || prediction.finger_count_quality !== 'reliable'
      || !Number.isInteger(count) || count < 0 || count > 5 || !states || !center
      || !FINGER_NAMES.every(name => typeof states[name] === 'boolean')
      || FINGER_NAMES.filter(name => states[name]).length !== count
      || ![center.x, center.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  const canonical = FINGER_NAMES.every((name, index) =>
    states[name] === (name === 'thumb' ? count === 5 : index <= count));
  return { count, states, center, canonical };
}

export function createCommandGate(settings) {
  let candidate = null;
  let previous = null;
  let lastValidAt = -Infinity;
  let lastNavigationAt = -Infinity;
  let heldAction = null;
  let diagnostics = {};

  function suspend(reason = 'Waiting for fresh stable samples') {
    previous = null;
    candidate = null;
    diagnostics = { stability: 'Interrupted', reason };
  }

  return {
    suspend,
    get diagnostics() { return diagnostics; },
    reset() {
      suspend('Recognition stopped');
      heldAction = null;
      lastValidAt = -Infinity;
      lastNavigationAt = -Infinity;
    },
    accept(prediction, now, bypassStability = false, canDispatch = true) {
      const pose = readFingerPose(prediction);
      const count = prediction?.finger_count;
      diagnostics = { count, mapped: Number.isInteger(count) ? COUNT_COMMANDS[count] : null,
        stability: 'Waiting', accepted: false, stableCount: null, pendingScrollCount: null };
      const reject = reason => {
        diagnostics.reason = reason;
        return null;
      };
      const accept = command => {
        diagnostics.accepted = true;
        diagnostics.reason = 'Accepted';
        return command;
      };
      if (!pose?.canonical) {
        // A brief ambiguous result can fall between two matching scroll samples.
        // One-shot actions still require uninterrupted samples.
        if ((candidate?.count === 1 || candidate?.count === 2) && now - lastValidAt < settings.maxScrollSampleGapMs) {
          diagnostics.pendingScrollCount = candidate.count;
          diagnostics.stability = 'Waiting for a matching scroll pose';
        } else {
          candidate = null;
          previous = null;
        }
        if (now - lastValidAt >= settings.releaseMs) {
          heldAction = null;
        }
        return reject(pose ? 'Unsupported finger combination'
          : prediction?.hand_detected ? 'Finger pose is uncertain' : 'No hand detected');
      }
      const elapsed = now - lastValidAt;
      const isScroll = pose.count === 1 || pose.count === 2;
      const samplingGap = isScroll ? settings.maxScrollSampleGapMs : settings.maxSampleGapMs;
      if (previous && elapsed <= samplingGap
          && Math.hypot(pose.center.x - previous.center.x, pose.center.y - previous.center.y) > settings.maxCenterJump) {
        candidate = null;
      }
      previous = pose;
      lastValidAt = now;
      if (candidate?.count !== pose.count || elapsed > samplingGap) {
        candidate = { count: pose.count, at: now, frames: 0 };
      }
      candidate.frames += 1;
      const required = bypassStability && pose.count <= 3 ? 1 : settings.consecutiveFrames;
      const age = now - candidate.at;
      if (isScroll && !bypassStability) {
        diagnostics.stability = `${Math.min(settings.scrollHoldMs, Math.round(age))}/${settings.scrollHoldMs} ms`;
        if (age < settings.scrollHoldMs || candidate.frames < 2) {
          diagnostics.pendingScrollCount = pose.count;
          return reject('Scroll pose is still stabilizing');
        }
      } else {
        diagnostics.stability = `${candidate.frames}/${required} frames`;
        if (pose.count !== 0 && candidate.frames < required) return reject('Pose is still stabilizing');
      }
      diagnostics.stableCount = pose.count;
      if (pose.count === 0 && candidate.frames < required) return accept('idle');
      if (heldAction !== pose.count) heldAction = null;
      if (heldAction === pose.count) return reject('Already executed. Release or change the pose.');
      const command = COUNT_COMMANDS[pose.count];
      if (pose.count <= 2) return accept(command);
      if (!canDispatch) return reject('Waiting for the previous browser command');
      if (pose.count >= 4) {
        if (now - candidate.at < settings.navigationHoldMs) return reject(`Hold the pose for ${settings.navigationHoldMs} ms`);
        if (now - lastNavigationAt < settings.navigationCooldownMs) return reject('Navigation cooldown');
        lastNavigationAt = now;
      }
      heldAction = pose.count;
      return accept(command);
    },
  };
}
