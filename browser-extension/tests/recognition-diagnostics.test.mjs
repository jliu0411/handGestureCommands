import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecognitionDiagnostics } from '../recognition-diagnostics.js';

const validPose = { raw: 1, stable: 1, quality: 'Reliable', confidence: .72, scroll: 'Valid pose', reason: 'Accepted' };
const delivered = { command: 'scrollDown', dispatched: true, worker: true, content: true, ok: true };

test('recognition reports are opt-in and count transitions, stops and dispatch failures', () => {
  const report = createRecognitionDiagnostics();
  report.observe(validPose, 0);
  assert.equal(report.report('0.2.3', 0), '');
  report.setEnabled(true, 1000);
  report.observe(validPose, 1000);
  report.command(delivered, true, 1011);
  report.observe({ ...validPose, raw: 2, pending: 2, scroll: 'Unconfirmed pose change' }, 1200);
  report.observe(validPose, 1300);
  report.sampling({ rate: 10, intervalMs: 100, peakGap: 130, apiMs: 30, captureMs: 4 }, 1300);
  report.sampling({ rate: 5, intervalMs: 200, peakGap: 340, apiMs: 33, captureMs: 5 }, 1400);
  report.command({ command: 'UPDATE_SCROLL', dispatched: true, worker: false, content: false,
    ok: false, message: 'Disconnected from https://example.com/private' }, false, 1500);
  report.command({ ...delivered, content: false, ok: false, message: 'Chrome is withholding website access' }, true, 1550);
  report.interrupt('Closed fist', 1550);
  const summary = report.report('0.2.3', 1700, 1300);
  assert.match(summary, /Raw count changes: 2 \(entered unconfirmed change: 1\)/);
  assert.match(summary, /1 accepted, 1 rejected by dispatch, 1 candidates failed to stabilize/);
  assert.match(summary, /Scroll stops: 1 \| command delivery failures: 2/);
  assert.match(summary, /10\.0 Hz.*130 ms/);
  assert.match(summary, /5\.0 Hz.*340 ms/);
  assert.match(summary, /Last valid pose: 400 ms ago/);
  assert.match(summary, /Closed fist/);
  assert.doesNotMatch(summary, /example\.com/);
  report.setEnabled(false, 1750);
  assert.equal(report.report('0.2.3', 1800), '');
});

test('diagnostics keep only recent distinct transitions in memory', () => {
  const report = createRecognitionDiagnostics(2);
  report.setEnabled(true, 10);
  report.observe({ ...validPose, reason: 'First' }, 20);
  for (let i = 30; i < 120; i += 10) report.observe({ ...validPose, reason: 'Second' }, i);
  report.observe({ ...validPose, reason: 'Third' }, 150);
  const summary = report.report('0.2.3', 180);
  assert.doesNotMatch(summary, /First/);
  assert.equal(summary.match(/Second/g)?.length, 1);
  assert.match(summary, /Third/);
});
