import argparse
from pathlib import Path

import joblib

from ml.evaluation.metrics import plot_class_distribution, write_metrics
from ml.preprocessing.features import FEATURES
from ml.training.train_random_forest import load_data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("datasets/processed/landmarks.csv"))
    parser.add_argument("--model", type=Path, default=Path("artifacts/models/random_forest.joblib"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/metrics/test"))
    parser.add_argument("--figures", type=Path, default=Path("artifacts/figures"))
    args = parser.parse_args()
    data, _, digest = load_data(args.data)
    artifact = joblib.load(args.model)
    if digest != artifact["dataset_sha256"]:
        raise ValueError("Prepared dataset differs from the one used during training")
    test = data.loc[data["split"] == "test"]
    write_metrics(artifact["model"], test[FEATURES].to_numpy(), test["label"], "test",
                  args.output, artifact["model_id"], args.figures / "test")
    plot_class_distribution(data, args.figures)


if __name__ == "__main__":
    main()
