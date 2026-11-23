import argparse
import hashlib
import json
from pathlib import Path
import platform
import uuid

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score

from ml.evaluation.metrics import write_metrics
from ml.preprocessing.features import FEATURES, GESTURES, PREPROCESSING
from ml.preprocessing.prepare import SPLITS


def load_data(path):
    metadata = json.loads((path.parent / "metadata.json").read_text(encoding="utf-8"))
    if metadata["preprocessing"] != PREPROCESSING or metadata["classes"] != GESTURES:
        raise ValueError("Preprocessing or gesture configuration changed; prepare the dataset again")
    data = pd.read_csv(path, dtype={"subject_id": str})
    if (set(data["split"]) != set(SPLITS) or data["path"].duplicated().any()
            or not np.isfinite(data[FEATURES]).all().all()):
        raise ValueError("Expected finite features, unique paths and all three splits")
    subjects = data["subject_id"].fillna("").str.strip()
    if metadata.get("split_strategy") == "image_stratified":
        if subjects.ne("").any():
            raise ValueError("Image-stratified data should have no subject IDs")
    elif subjects.eq("").any() or data.groupby(subjects)["split"].nunique().gt(1).any():
        raise ValueError("Expected complete subject IDs and subject-disjoint splits")
    for split in SPLITS:
        if set(data.loc[data["split"] == split, "label"]) != set(GESTURES):
            raise ValueError(f"{split} must contain all six labels")
    return data, metadata, hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("datasets/processed/landmarks.csv"))
    parser.add_argument("--model", type=Path, default=Path("artifacts/models/random_forest.joblib"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/metrics/validation"))
    parser.add_argument("--figures", type=Path, default=Path("artifacts/figures"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    data, metadata, digest = load_data(args.data)
    train, val = (data.loc[data["split"] == split] for split in ("train", "val"))
    train_features, val_features = train[FEATURES].to_numpy(), val[FEATURES].to_numpy()
    candidates = []
    for settings in ({}, {"min_samples_leaf": 2}, {"max_features": 0.5}):
        candidate = RandomForestClassifier(n_estimators=300, random_state=args.seed, n_jobs=-1,
                                           class_weight="balanced_subsample", **settings)
        candidate.fit(train_features, train["label"])
        predicted = candidate.predict(val_features)
        scores = {
            "macro_f1": f1_score(val["label"], predicted, average="macro"),
            "accuracy": accuracy_score(val["label"], predicted),
        }
        candidates.append((candidate, scores))
    best = max(range(len(candidates)), key=lambda index: (
        candidates[index][1]["macro_f1"], candidates[index][1]["accuracy"],
    ))
    model, _ = candidates[best]
    selection = {
        "criterion": "validation macro F1, then accuracy",
        "selected_candidate": best,
        "candidates": [{**scores, "parameters": model.get_params()} for model, scores in candidates],
        "training_samples": len(train),
        "validation_samples": len(val),
        "python_version": platform.python_version(),
        "seed": args.seed,
        "dataset_sha256": digest,
    }
    model.set_params(n_jobs=1)
    model_id = uuid.uuid4().hex
    write_metrics(model, val_features, val["label"], "validation", args.output, model_id,
                  args.figures / "validation", selection=selection)
    args.model.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.model.with_name(f"{args.model.name}.{model_id}.tmp")
    try:
        joblib.dump({
            "model": model, "model_id": model_id, "classes": GESTURES,
            "preprocessing": PREPROCESSING, "dataset": metadata, "dataset_sha256": digest,
            "seed": args.seed, "sklearn_version": sklearn.__version__, "selection": selection,
        }, temporary, compress=3)
        temporary.replace(args.model)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
