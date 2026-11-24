import { API_ENDPOINTS } from './config.js';

export async function checkGestureBackend(request, api, signal) {
  const health = await request(api, '/health', {}, signal);
  if (health?.model_ready !== true) return null;
  const model = await request(api, '/models', {}, signal);
  if (model?.loaded !== true || model.model_name !== 'random_forest') return null;
  return { api, fingerCountAvailable: model.capabilities?.finger_count === true };
}

export async function findGestureBackend(request, signal) {
  let legacy = false;
  for (const api of API_ENDPOINTS) {
    try {
      const backend = await checkGestureBackend(request, api, signal);
      if (backend?.fingerCountAvailable) return backend;
      legacy ||= Boolean(backend);
    } catch {
      signal?.throwIfAborted();
    }
  }
  if (legacy) throw new Error('Restart FastAPI from this checkout to enable finger counting.');
  throw new Error('Gesture API unavailable on 127.0.0.1:8000 or :8765.');
}
