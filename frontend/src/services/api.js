const api = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function request(path, options) {
  const response = await fetch(api + path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'Prediction service unavailable.');
  }
  return data;
}

export async function checkHealth(signal) {
  const status = await request('/health', { signal });
  if (!status.model_ready) throw new Error(status.model_error || 'The gesture model is unavailable.');
}

export function predict(frame, signal) {
  return request('/predict', {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: frame, signal,
  });
}
