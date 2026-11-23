import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandGate } from './commands.js';

const peace = { gesture: 'peace', confidence: 0.9, hand_detected: true, action: 'next' };
const point = { ...peace, gesture: 'point', action: 'select' };

test('requires three matches and fires once during a held gesture', () => {
  const gate = createCommandGate({ minimumConfidence: 0.7, frames: 3, cooldown: 1500 });
  assert.equal(gate.accept(peace, 0), null);
  assert.equal(gate.accept(peace, 350), null);
  assert.equal(gate.accept(peace, 700), 'next');
  assert.equal(gate.accept(peace, 4000), null);
});

test('hand loss and low confidence reset the streak while preserving cooldown', () => {
  const gate = createCommandGate({ minimumConfidence: 0.7, frames: 2, cooldown: 1500 });
  gate.accept(peace, 0);
  assert.equal(gate.accept(peace, 100), 'next');
  gate.accept(point, 200);
  gate.accept({ hand_detected: false }, 300);
  assert.equal(gate.accept(point, 400), null);
  assert.equal(gate.accept(point, 500), null);
  gate.accept({ ...point, confidence: 0.55 }, 1500);
  assert.equal(gate.accept(point, 1600), null);
  assert.equal(gate.accept(point, 1700), 'select');
});
