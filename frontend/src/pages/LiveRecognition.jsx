import React, { useRef, useState } from 'react';
import gestures from '../../../gesture_config.json';
import { useRecognition } from '../hooks/useRecognition';
import { createCommandGate } from '../services/commands';

const cards = ['Camera framing', 'Gesture practice', 'Command review'];
const statuses = {
  idle: 'Camera off', connecting: 'Checking prediction service', permission: 'Waiting for camera permission',
  live: 'Camera on', unavailable: 'Prediction service unavailable', camera_error: 'Camera unavailable',
  retrying: 'Prediction service unavailable · retrying',
};
const initialDemo = { state: 'stopped', index: 0, selection: null, last: null };

function configuredNumber(value, fallback, min, max) {
  const number = Number(value || fallback);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function applyCommand(demo, action) {
  const next = { ...demo, last: action };
  switch (action) {
    case 'pause': return { ...next, state: 'paused' };
    case 'stop': return { ...next, state: 'stopped', index: 0, selection: null };
    case 'confirm': return { ...next, state: 'running', selection: demo.index };
    case 'cancel': return { ...next, selection: null };
    case 'next': return { ...next, index: (demo.index + 1) % cards.length };
    case 'select': return { ...next, selection: demo.index };
    default: return demo;
  }
}

export default function LiveRecognition() {
  const [prediction, setPrediction] = useState(null);
  const [demo, setDemo] = useState(initialDemo);
  const [history, setHistory] = useState([]);
  const gate = useRef(null);
  if (!gate.current) {
    gate.current = createCommandGate({
      minimumConfidence: configuredNumber(import.meta.env.VITE_COMMAND_CONFIDENCE, 0.70, 0, 1),
      frames: Math.ceil(configuredNumber(import.meta.env.VITE_STABLE_FRAMES, 3, 1, Infinity)),
      cooldown: configuredNumber(import.meta.env.VITE_COMMAND_COOLDOWN_MS, 1500, 0, Infinity),
    });
  }
  const previous = useRef(null);
  const nextHistoryId = useRef(0);

  function onPrediction(result) {
    setPrediction(result);
    const action = gate.current.accept(result, performance.now());
    const changed = result?.gesture !== previous.current;
    previous.current = result?.gesture;
    if (result?.action && changed) {
      const entry = { ...result, id: nextHistoryId.current++, time: new Date() };
      setHistory(items => [entry, ...items].slice(0, 20));
    }
    if (!action) return;
    setDemo(current => {
      if (current.state !== 'running' && !['confirm', 'stop', 'cancel'].includes(action)) return current;
      return applyCommand(current, action);
    });
  }

  const { video, start, stop, status, error } = useRecognition(onPrediction);
  const active = ['connecting', 'permission', 'live', 'retrying'].includes(status);
  const label = gestures[prediction?.gesture]?.name
    ?? ({ no_hand: 'No hand detected', unknown: 'Unknown gesture' }[prediction?.gesture] || 'Awaiting frame');

  function startRecognition() {
    setDemo({ ...initialDemo, state: 'running' });
    setPrediction(null);
    void start();
  }

  function stopRecognition() {
    stop();
    gate.current.reset();
    previous.current = null;
    setPrediction(null);
    setDemo(initialDemo);
  }

  return (
    <>
      <h1>Live recognition</h1>
      <div className="live-grid">
        <section className="panel">
          <div className="section-heading"><h2>Webcam</h2><span role="status">{statuses[status]}</span></div>
          <div className="preview">
            <video ref={video} autoPlay muted playsInline aria-label="Live webcam preview" />
            {status !== 'live' && status !== 'retrying' && <p>{statuses[status]}</p>}
          </div>
          <div className="controls">
            <button className="primary" disabled={active} onClick={startRecognition}>Start recognition</button>
            <button disabled={!active} onClick={stopRecognition}>Stop recognition</button>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
        </section>
        <section className="panel">
          <h2>Prediction</h2>
          <p className="prediction">{label}</p>
          <dl className="readout">
            <dt>Confidence</dt><dd>{prediction?.confidence == null ? '—' : Math.round(prediction.confidence * 100) + '%'}</dd>
            <dt>Current action</dt><dd>{prediction?.action || '—'}</dd>
            <dt>Hand detected</dt><dd>{prediction ? (prediction.hand_detected ? 'Yes' : 'No') : '—'}</dd>
          </dl>
          <h2>Gesture history</h2>
          {history.length === 0 ? <p>No recognized gestures yet.</p> : (
            <ol className="history">
              {history.map(item => (
                <li key={item.id}>
                  <time dateTime={item.time.toISOString()}>{item.time.toLocaleTimeString()}</time>
                  <span>{gestures[item.gesture].name}</span>
                  <span>{Math.round(item.confidence * 100)}%</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <section className="panel demo">
        <div className="section-heading"><h2>Gesture-controlled demo</h2><span className="capital">{demo.state}</span></div>
        <p>Use a peace sign to advance and point to select. Use thumbs up to resume or confirm.</p>
        <ol className="cards">
          {cards.map((card, index) => (
            <li key={card} className={demo.index === index ? 'current' : ''} aria-current={demo.index === index ? 'true' : undefined}>
              {card}{demo.selection === index && <small>Selected</small>}
            </li>
          ))}
        </ol>
        <dl className="readout">
          <dt>Current selection</dt><dd>{cards[demo.selection] || '—'}</dd>
          <dt>Last executed command</dt><dd>{demo.last || '—'}</dd>
        </dl>
      </section>
    </>
  );
}
