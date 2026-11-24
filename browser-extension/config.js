export const API_ENDPOINTS = Object.freeze(['http://127.0.0.1:8000', 'http://127.0.0.1:8765']);

export const COMMAND_LABELS = Object.freeze({
  idle: 'Stop scrolling / idle',
  scrollUp: 'Scroll up',
  scrollDown: 'Scroll down',
  highlight: 'Highlight next eligible link',
  activate: 'Open highlighted eligible link',
  back: 'Go back',
});

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
export const COUNT_COMMANDS = ['idle', 'scrollDown', 'scrollUp', 'highlight', 'activate', 'back'];
export const START_SCROLL_UP = 'START_SCROLL_UP';
export const START_SCROLL_DOWN = 'START_SCROLL_DOWN';
export const UPDATE_SCROLL = 'UPDATE_SCROLL';
export const STOP_SCROLL = 'STOP_SCROLL';

export const SETTINGS = Object.freeze({
  consecutiveFrames: 3,
  navigationHoldMs: 700,
  navigationCooldownMs: 1000,
  releaseMs: 250,
  maxSampleGapMs: 250,
  maxCenterJump: 0.22,
  scrollSpeed: 400,
  scrollLeaseMs: 600,
  scrollAckTimeoutMs: 200,
  scrollHoldMs: 180,
  maxScrollSampleGapMs: 400,
  scrollPoseChangeGraceMs: 450,
  scrollUnknownGraceMs: 350,
  scrollNoHandGraceMs: 350,
  frameIntervalMs: 75,
});

export function isOneShotCommand(value) {
  return value === 'highlight' || value === 'activate' || value === 'back';
}
