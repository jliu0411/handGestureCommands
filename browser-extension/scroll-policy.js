export function createScrollPolicy(settings) {
  let current = null;
  let stopReason = null;

  return {
    get stopReason() { return stopReason; },
    reset() { current = null; stopReason = null; },
    accept(pose, handDetected, stableCommand, at, stableCount = null) {
      stopReason = null;
      if (current && at >= current.expiresAt) {
        stopReason = current.source === 'Valid pose' ? 'No fresh prediction' : `${current.source} expired`;
        current = null;
      }
      const count = pose?.canonical ? pose.count : null;
      const direction = count === 1 ? 'scrollDown' : count === 2 ? 'scrollUp' : null;
      if (count === 0 || (count >= 3 && stableCount === count)) {
        stopReason = count === 0 ? 'Closed fist' : 'Confirmed pose change';
        current = null;
      } else if (direction && (current?.direction === direction || stableCommand === direction)) {
        if (current && current.direction !== direction) stopReason = 'Confirmed direction change';
        current = { direction, count, eventAt: at, expiresAt: at + settings.scrollLeaseMs, source: 'Valid pose' };
      } else if (current?.source === 'Valid pose') {
        const [grace, source] = count !== null ? [settings.scrollPoseChangeGraceMs, 'Unconfirmed pose change']
          : handDetected ? [settings.scrollUnknownGraceMs, 'Uncertain pose grace period']
            : [settings.scrollNoHandGraceMs, 'Missing hand grace period'];
        current = { ...current, eventAt: at, expiresAt: at + Math.min(grace, settings.scrollLeaseMs), source };
      }
      return current;
    },
  };
}
