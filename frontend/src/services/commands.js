export function createCommandGate({ minimumConfidence, frames, cooldown }) {
  let previous = null;
  let streak = 0;
  let fired = false;
  let lastAt = -Infinity;

  return {
    reset() {
      previous = null;
      streak = 0;
      fired = false;
    },
    accept(prediction, now) {
      if (!prediction?.hand_detected || !prediction.action || prediction.confidence < minimumConfidence) {
        this.reset();
        return null;
      }
      if (prediction.gesture !== previous) {
        this.reset();
        previous = prediction.gesture;
      }
      streak += 1;
      if (fired || streak < frames || now - lastAt < cooldown) return null;
      fired = true;
      lastAt = now;
      return prediction.action;
    },
  };
}
