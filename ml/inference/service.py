from threading import Lock

import joblib
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.utils.validation import check_is_fitted

from ml.preprocessing.features import FEATURES, GESTURES, PREPROCESSING, HandDetector


class GestureService:
    def __init__(self, artifact, detector, threshold):
        self.model = artifact["model"]
        self.model_id = artifact["model_id"]
        self.detector = detector
        self.threshold = threshold
        self.lock = Lock()

    @classmethod
    def load(cls, path, threshold):
        artifact = joblib.load(path)
        model = artifact["model"]
        if (not isinstance(model, RandomForestClassifier)
                or artifact["preprocessing"] != PREPROCESSING
                or artifact["classes"] != GESTURES
                or artifact["sklearn_version"] != sklearn.__version__):
            raise ValueError("Incompatible Random Forest artifact. Retrain in the current environment.")
        check_is_fitted(model)
        if set(model.classes_) != set(GESTURES) or model.n_features_in_ != len(FEATURES):
            raise ValueError("Model features or classes do not match the gesture configuration")
        return cls(artifact, HandDetector(), threshold)

    def close(self):
        self.detector.close()

    def predict(self, image):
        with self.lock:
            try:
                features = self.detector.extract(image)
            except ValueError:
                return self.result("unknown", None, True)
        if features is None:
            return self.result("no_hand", None, False)
        probabilities = self.model.predict_proba([features])[0]
        index = probabilities.argmax()
        confidence = float(probabilities[index])
        gesture = str(self.model.classes_[index]) if confidence >= self.threshold else "unknown"
        return self.result(gesture, confidence, True)

    @staticmethod
    def result(gesture, confidence, hand_detected):
        return {
            "gesture": gesture, "confidence": confidence,
            "action": GESTURES.get(gesture, {}).get("action"),
            "hand_detected": hand_detected, "model_name": "random_forest",
        }
