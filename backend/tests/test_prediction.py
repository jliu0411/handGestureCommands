from io import BytesIO
import json

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from backend.app.main import create_app
from backend.tests.test_finger_count import hand, image
from ml.inference.service import GestureService
from ml.preprocessing.features import GESTURES, HandObservation, normalize_landmarks
from ml.preprocessing.prepare import validated_records


class FixedClassifier:
    classes_ = np.array(list(GESTURES))

    def __init__(self, confidence):
        self.confidence = confidence

    def predict_proba(self, features):
        assert np.asarray(features).shape == (1, 63)
        return np.array([[(1 - self.confidence) / 5] * 4
                         + [self.confidence, (1 - self.confidence) / 5]])


class Detector:
    def __init__(self, found):
        self.found = found

    def observe(self, image):
        assert image.shape == (48, 64, 3)
        return HandObservation(np.ones(63), (0.42, 0.75)) if self.found else None

    def close(self):
        pass


def client_for(found=True, confidence=0.91, **kwargs):
    return TestClient(create_app(
        service_loader=lambda _, threshold: GestureService(
            {"model": FixedClassifier(confidence), "model_id": "unit-test"}, Detector(found), threshold,
        ), **kwargs,
    ))


@pytest.fixture
def jpeg():
    stream = BytesIO()
    Image.new("RGB", (64, 48)).save(stream, "JPEG")
    return stream.getvalue()


def test_feature_normalization():
    points = np.arange(63).reshape(21, 3)
    vector = normalize_landmarks(points)
    assert vector.shape == (63,)
    np.testing.assert_array_equal(vector[:3], [0, 0, 0])
    np.testing.assert_allclose(vector, normalize_landmarks(points * 3 + 7), atol=1e-6)
    assert np.linalg.norm(vector.reshape(21, 3), axis=1).max() == pytest.approx(1)


@pytest.mark.parametrize("points", [np.zeros((21, 3)), np.zeros((20, 3)), np.full((21, 3), np.nan)])
def test_reject_malformed_features(points):
    with pytest.raises(ValueError):
        normalize_landmarks(points)


def test_reject_subject_overlap(tmp_path):
    rows = [
        {"path": f"{split}.jpg", "label": "palm", "subject_id": "person", "split": split}
        for split in ("train", "test")
    ]
    with pytest.raises(ValueError, match="multiple splits"):
        list(validated_records(rows, tmp_path))


@pytest.mark.parametrize("found,confidence,label,action", [
    (True, 0.91, "peace", "next"),
    (True, 0.40, "unknown", None),
    (False, 0.91, "no_hand", None),
])
def test_prediction_states(jpeg, found, confidence, label, action):
    with client_for(found, confidence) as client:
        response = client.post("/predict", content=jpeg, headers={"Content-Type": "image/jpeg"})
        assert response.status_code == 200
        expected = {
            "gesture": label, "action": action, "confidence": confidence if found else None,
            "hand_detected": found, "model_name": "random_forest",
            "finger_count": None, "finger_states": None, "finger_count_quality": "uncertain" if found else None,
        }
        if found:
            expected["hand_center"] = {"x": 0.42, "y": 0.75}
        assert response.json() == expected


def test_invalid_images_and_size(jpeg, monkeypatch):
    monkeypatch.setenv("GESTURE_MAX_FRAME_BYTES", str(len(jpeg)))
    with client_for() as client:
        assert client.post("/predict", content=b"no").status_code == 415
        assert client.post("/predict", content=b"no", headers={"Content-Type": "image/jpeg"}).status_code == 422
        assert client.post("/predict", content=jpeg, headers={"Content-Type": "image/png"}).status_code == 422
        assert client.post("/predict", content=jpeg + b"!", headers={"Content-Type": "image/jpeg"}).status_code == 413
        assert client.post("/predict", content=iter([jpeg, b"!"]),
                           headers={"Content-Type": "image/jpeg"}).status_code == 413


def test_missing_model(jpeg, tmp_path):
    with TestClient(create_app(model_path=tmp_path / "missing.joblib")) as client:
        assert not client.get("/health").json()["model_ready"]
        assert not client.get("/models").json()["loaded"]
        assert client.get("/metrics").status_code == 503
        response = client.post("/predict", content=jpeg, headers={"Content-Type": "image/jpeg"})
        assert response.status_code == 503
        assert "Model file missing" in response.json()["detail"]


def test_metrics_match_model(tmp_path):
    split = tmp_path / "validation"
    split.mkdir()
    report = split / "model_metrics.json"
    with client_for(metrics_dir=tmp_path) as client:
        assert client.get("/health").json()["model_ready"]
        model = client.get("/models").json()
        assert model["gestures"] == GESTURES
        assert model["capabilities"] == {"hand_center": True, "finger_count": True}
        assert client.get("/metrics").status_code == 404
        report.write_text(json.dumps({"model_id": "obsolete"}))
        assert client.get("/metrics").status_code == 404
        report.write_text(json.dumps({"model_id": "unit-test", "accuracy": 0.9}))
        assert client.get("/metrics").json()["validation"]["accuracy"] == 0.9


@pytest.mark.parametrize("detected_hands", [1, 2])
def test_finger_count_is_independent_of_random_forest_threshold(jpeg, detected_hands):
    points = hand(4)
    detector = Detector(True)
    detector.observe = lambda _: HandObservation(points.reshape(-1), (.5, .5), image(points), detected_hands)
    app = create_app(service_loader=lambda _, threshold: GestureService(
        {"model": FixedClassifier(.4), "model_id": "unit-test"}, detector, threshold,
    ))
    with TestClient(app) as client:
        prediction = client.post("/predict", content=jpeg, headers={"Content-Type": "image/jpeg"}).json()
    assert prediction["gesture"] == "unknown"
    assert prediction["finger_count"] == (4 if detected_hands == 1 else None)
    assert prediction["finger_states"] == (
        {"thumb": False, "index": True, "middle": True, "ring": True, "pinky": True}
        if detected_hands == 1 else None
    )
    assert prediction["finger_count_quality"] == ("reliable" if detected_hands == 1 else "uncertain")


def test_ambiguous_finger_geometry_sets_uncertain_quality_without_a_count(jpeg):
    points = hand(1)
    points[8] = points[7] + [.17, .06, 0]
    detector = Detector(True)
    detector.observe = lambda _: HandObservation(points.reshape(21 * 3), (.5, .5), image(points))
    app = create_app(service_loader=lambda _, threshold: GestureService(
        {"model": FixedClassifier(.91), "model_id": "unit-test"}, detector, threshold,
    ))
    with TestClient(app) as client:
        prediction = client.post("/predict", content=jpeg, headers={"Content-Type": "image/jpeg"}).json()
    assert prediction["gesture"] == "peace"
    assert prediction["finger_count"] is None
    assert prediction["finger_states"] is None
    assert prediction["finger_count_quality"] == "uncertain"
