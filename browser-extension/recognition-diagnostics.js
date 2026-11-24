import { UPDATE_SCROLL } from './config.js';

export function deliverySummary(trace) {
  if (trace.ok) return 'Executed';
  if (!trace.dispatched) return 'Stopped before dispatch';
  if (!trace.worker) return 'Runtime acknowledgment missing';
  if (/scroll farther/i.test(trace.message)) return 'Page scroll boundary';
  if (/permission|withholding|cannot access|restricted|blocked by chrome/i.test(trace.message)) return 'Chrome site access';
  if (/changed|is still loading|unavailable/i.test(trace.message)) return 'Page changed or unavailable';
  if (/lease|expired|no longer active/i.test(trace.message)) return 'Scroll lease ended';
  return trace.content ? 'Content script rejected command' : 'Worker could not reach content script';
}

export function createRecognitionDiagnostics(limit = 120) {
  let enabled = false;
  let startedAt = 0;
  let events = [];
  let stats;
  let previous;
  let currentRate;
  let lastLoggedRate;
  let latest;

  function add(at, event) {
    events.push(`${((at - startedAt) / 1000).toFixed(2)}s ${event}`);
    if (events.length > limit) events.shift();
  }

  return {
    setEnabled(value, at) {
      enabled = value;
      startedAt = at;
      events = [];
      stats = { rawChanges: 0, unconfirmedChanges: 0, rejectedCandidates: 0, starts: 0, rejectedStarts: 0,
        interruptions: 0, deliveryFailures: 0 };
      previous = undefined;
      currentRate = undefined;
      lastLoggedRate = undefined;
      latest = undefined;
    },
    observe(snapshot, at) {
      if (!enabled) return;
      const { raw, stable, pending, quality, reason, scroll } = snapshot;
      const rawChanged = Number.isInteger(raw) && Number.isInteger(previous?.raw) && raw !== previous.raw;
      if (rawChanged) stats.rawChanges += 1;
      if (rawChanged && scroll === 'Unconfirmed pose change') stats.unconfirmedChanges += 1;
      if (previous?.pending != null && previous.pending !== pending && previous.pending !== stable) {
        stats.rejectedCandidates += 1;
      }
      const transition = `raw ${raw ?? '—'} | stable ${stable ?? '—'} | ${quality} | ${scroll} | ${reason}`;
      if (transition !== previous?.transition) {
        const age = snapshot.validPoseAge;
        add(at, transition + (Number.isFinite(age) ? ` | last valid pose ${age} ms ago` : ''));
      }
      previous = { raw, pending, transition };
      latest = snapshot;
    },
    sampling({ rate, intervalMs, peakGap, apiMs, captureMs }, at) {
      if (!enabled) return;
      currentRate = `${rate.toFixed(1)} Hz, avg interval ${Math.round(intervalMs)} ms, peak gap ${Math.round(peakGap)} ms, avg JPEG ${Math.round(captureMs)} ms, avg API ${Math.round(apiMs)} ms`;
      if (lastLoggedRate === undefined || Math.abs(rate - lastLoggedRate) >= Math.max(0.75, lastLoggedRate * 0.20)) {
        lastLoggedRate = rate;
        add(at, 'Sampling ' + currentRate);
      }
    },
    command(trace, start, at) {
      if (!enabled) return;
      if (start) stats[trace.ok ? 'starts' : 'rejectedStarts'] += 1;
      if (!trace.ok && trace.dispatched && !trace.content) stats.deliveryFailures += 1;
      if (trace.ok && trace.command === UPDATE_SCROLL) return;
      add(at, `${trace.command} | sent ${trace.dispatched ? 'yes' : 'no'} | worker ${trace.worker ? 'yes' : 'no'} | content ${trace.content ? 'yes' : 'no'} | ${deliverySummary(trace)}`);
    },
    interrupt(reason, at) {
      if (!enabled) return;
      stats.interruptions += 1;
      add(at, 'Scroll stopped: ' + reason);
    },
    report(version, at, lastValidPoseAt = null) {
      if (!enabled) return '';
      const summary = [
        `Hand Gesture Controls ${version}`,
        `Recorded for ${((at - startedAt) / 1000).toFixed(1)}s`,
        `Raw count changes: ${stats.rawChanges} (entered unconfirmed change: ${stats.unconfirmedChanges})`,
        `Scroll starts: ${stats.starts} accepted, ${stats.rejectedStarts} rejected by dispatch, ${stats.rejectedCandidates} candidates failed to stabilize`,
        `Scroll stops: ${stats.interruptions} | command delivery failures: ${stats.deliveryFailures}`,
        `Latest sampling: ${currentRate ?? '—'}`,
        `Latest count: ${latest?.raw ?? '—'} raw, ${latest?.stable ?? '—'} stable | quality: ${latest?.quality ?? '—'}`,
        `Last valid pose: ${lastValidPoseAt === null ? '—' : Math.round(at - lastValidPoseAt) + ' ms ago'}`,
        `Latest Random Forest confidence: ${Number.isFinite(latest?.confidence) ? Math.round(latest.confidence * 100) + '%' : '—'}`,
        '',
        `Recent transitions (up to ${limit})`,
      ];
      return ['```text', ...summary, ...events, '```'].join('\n');
    },
  };
}
