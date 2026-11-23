import React, { useEffect, useState } from 'react';
import gestures from '../../gesture_config.json';
import LiveRecognition from './pages/LiveRecognition';

const pages = { home: 'Home', live: 'Live Recognition', about: 'About' };
const getPage = () => {
  const page = location.hash.slice(1);
  return Object.hasOwn(pages, page) ? page : 'home';
};

function GestureList() {
  return (
    <ul className="gesture-list">
      {Object.entries(gestures).map(([label, gesture]) => (
        <li key={label}><span>{gesture.name}</span><strong>{gesture.action}</strong></li>
      ))}
    </ul>
  );
}

function Home() {
  return (
    <>
      <section className="hero">
        <h1>AI-Powered Hand Gesture Recognition</h1>
        <p>Use your webcam to recognize six hand poses and turn them into commands in a card demo.</p>
        <a className="button primary" href="#live">Start recognition <span aria-hidden="true">↗</span></a>
      </section>
      <section className="panel">
        <h2>Supported gestures</h2>
        <GestureList />
      </section>
    </>
  );
}

function About() {
  return (
    <>
      <h1>About the system</h1>
      <section className="panel about">
        <h2>From camera frame to command</h2>
        <p>MediaPipe detects one hand and extracts 21 three-dimensional landmarks. A Random Forest
          classifies the normalized landmarks. The demo acts after consecutive confident predictions.</p>
        <h2>Supported gestures</h2>
        <GestureList />
        <h2>Limitations</h2>
        <p>Keep one hand fully visible in good lighting. Camera angle, occlusion and unfamiliar poses
          can affect predictions. Confidence is a classifier score and can be high for an unsupported pose.</p>
      </section>
    </>
  );
}

export default function App() {
  const [page, setPage] = useState(getPage);
  useEffect(() => {
    const update = () => setPage(getPage());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return (
    <>
      <header className="site-header">
        <div className="shell header-content">
          <a className="brand" href="#home">Hand Gesture Recognition</a>
          <nav aria-label="Main navigation">
            {Object.entries(pages).map(([id, name]) => (
              <a key={id} href={'#' + id} aria-current={page === id ? 'page' : undefined}>{name}</a>
            ))}
          </nav>
        </div>
      </header>
      <main className="shell">
        {page === 'home' && <Home />}
        {page === 'live' && <LiveRecognition />}
        {page === 'about' && <About />}
      </main>
    </>
  );
}
