import { useEffect, useRef, useState } from 'react';
import { checkHealth, predict } from '../services/api';

const configuredInterval = Number(import.meta.env.VITE_FRAME_INTERVAL_MS || 333);
const interval = Number.isFinite(configuredInterval) ? Math.max(100, configuredInterval) : 333;

function capture(video, canvas) {
  if (!video.videoWidth || !video.videoHeight) return Promise.resolve(null);
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
}

export function useRecognition(onPrediction) {
  const video = useRef(null);
  const session = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  function release() {
    const active = session.current;
    session.current = null;
    if (!active) return;
    clearTimeout(active.timer);
    active.controller.abort();
    active.stream?.getTracks().forEach(track => track.stop());
    if (video.current) video.current.srcObject = null;
  }

  useEffect(() => () => release(), []);

  function stop() {
    release();
    setError('');
    setStatus('idle');
  }

  async function start() {
    if (session.current) return;
    const active = { controller: new AbortController() };
    session.current = active;
    const current = () => session.current === active;
    const signal = () => AbortSignal.any([active.controller.signal, AbortSignal.timeout(8000)]);
    setStatus('connecting');
    setError('');
    try {
      await checkHealth(signal());
      if (!current()) return;
    } catch (failure) {
      if (!current()) return;
      release();
      setStatus('unavailable');
      setError(failure instanceof TypeError ? 'Start the FastAPI server and try again.' : failure.message);
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Open this page on localhost or HTTPS to use the camera.');
      }
      setStatus('permission');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      });
      if (!current()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      active.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (!current()) return;
          release();
          onPrediction(null);
          setStatus('camera_error');
          setError('The camera disconnected. Reconnect it and start again.');
        });
      }
      video.current.srcObject = stream;
      await video.current.play();
      if (!current()) return;
      setStatus('live');
    } catch (failure) {
      if (!current()) return;
      release();
      setStatus('camera_error');
      setError(failure.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser and try again.'
        : failure.message);
      return;
    }

    const canvas = document.createElement('canvas');
    async function sample() {
      const started = performance.now();
      try {
        const frame = await capture(video.current, canvas);
        if (!current()) return;
        if (frame) {
          const prediction = await predict(frame, signal());
          if (!current()) return;
          setStatus('live');
          setError('');
          onPrediction(prediction);
        }
      } catch (failure) {
        if (!current()) return;
        onPrediction(null);
        setStatus('retrying');
        setError(failure instanceof TypeError ? 'Could not reach the prediction service.' : failure.message);
        active.timer = setTimeout(sample, Math.max(1000, interval));
        return;
      }
      if (current()) active.timer = setTimeout(sample, Math.max(0, interval - (performance.now() - started)));
    }
    void sample();
  }

  return { video, start, stop, status, error };
}
