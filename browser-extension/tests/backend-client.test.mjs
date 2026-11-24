import assert from 'node:assert/strict';
import test from 'node:test';
import { findGestureBackend } from '../backend-client.js';
import { API_ENDPOINTS } from '../config.js';

function servers(fingerCountPort) {
  return async (api, path) => {
    if (path === '/health') return { model_ready: true };
    return { loaded: true, model_name: 'random_forest',
      capabilities: api === fingerCountPort ? { finger_count: true } : { hand_center: true } };
  };
}

test('prefers the finger-count server when the previous API is also running', async () => {
  assert.deepEqual(await findGestureBackend(servers(API_ENDPOINTS[1])),
    { api: API_ENDPOINTS[1], fingerCountAvailable: true });
});

test('requires a compatible server and reports an unavailable backend separately', async () => {
  await assert.rejects(findGestureBackend(servers(null)), /Restart FastAPI/);
  await assert.rejects(findGestureBackend(async () => { throw new Error('offline'); }), /unavailable/);
});
