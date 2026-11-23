import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
GESTURES = json.loads((ROOT / "gesture_config.json").read_text(encoding="utf-8"))
FEATURES = [f"{axis}{index}" for index in range(21) for axis in "xyz"]
PREPROCESSING = {
    "version": 1, "features": FEATURES, "detector": "mediapipe-hands-0.10.21",
    "normalization": "wrist-centered, aspect-corrected, max wrist distance",
    "detection_confidence": 0.5, "max_frame_edge": 960,
}


def normalize_landmarks(points, aspect_ratio=1.0):
    points = np.asarray(points, dtype=np.float32)
    if points.shape != (21, 3) or not np.isfinite(points).all():
        raise ValueError("Expected 21 finite xyz landmarks")
    centered = points - points[0]
    centered[:, 1] *= aspect_ratio
    scale = np.linalg.norm(centered, axis=1).max()
    if not np.isfinite(scale) or scale <= 1e-8:
        raise ValueError("Degenerate landmarks")
    return (centered / scale).reshape(-1)


class HandOutsideBox(ValueError):
    """The detected landmarks do not match the annotated hand."""


class HandDetector:
    def __init__(self):
        import mediapipe as mp

        self.hands = mp.solutions.hands.Hands(
            static_image_mode=True, max_num_hands=1,
            min_detection_confidence=PREPROCESSING["detection_confidence"],
        )

    def close(self):
        self.hands.close()

    def extract(self, bgr, expected_bbox=None):
        height, width = bgr.shape[:2]
        scale = PREPROCESSING["max_frame_edge"] / max(height, width)
        if scale < 1:
            bgr = cv2.resize(bgr, (max(1, round(width * scale)), max(1, round(height * scale))),
                             interpolation=cv2.INTER_AREA)
        result = self.hands.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        if not result.multi_hand_landmarks:
            return None
        points = [(point.x, point.y, point.z) for point in result.multi_hand_landmarks[0].landmark]
        features = normalize_landmarks(points, bgr.shape[0] / bgr.shape[1])
        if expected_bbox is not None:
            box = np.asarray(expected_bbox)
            lower = box[:2] - box[2:] * 0.15
            upper = box[:2] + box[2:] * 1.15
            xy = np.asarray(points)[:, :2]
            if np.count_nonzero(((xy >= lower) & (xy <= upper)).all(axis=1)) < 11:
                raise HandOutsideBox("Detected hand is outside the target annotation")
        return features
