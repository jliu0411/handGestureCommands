"""Reload an image classifier and evaluate its selected checkpoint."""

import argparse
import hashlib
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from sklearn.metrics import classification_report, confusion_matrix
import torch
from torch.utils.data import DataLoader

from ml.data.image_dataset import GestureImageDataset, load_image_splits
from ml.data.image_transforms import build_image_transform
from ml.models.image_classifiers import build_image_model


@torch.inference_mode()
def evaluate(model, samples, batch_size, labels):
    dataset = GestureImageDataset(samples, build_image_transform())
    expected, predicted = [], []
    for images, targets in DataLoader(dataset, batch_size=batch_size):
        expected.extend(targets.tolist())
        predicted.extend(model(images).argmax(dim=1).tolist())

    indices = list(range(len(labels)))
    report = classification_report(
        expected, predicted, labels=indices, target_names=labels,
        output_dict=True, zero_division=0,
    )
    return {
        "samples": len(expected),
        "accuracy": report["accuracy"],
        "macro_f1": report["macro avg"]["f1-score"],
        "per_class": {label: report[label] for label in labels},
        "confusion_matrix": confusion_matrix(expected, predicted, labels=indices).tolist(),
    }


def plot_history(history, output):
    rows = history["epochs"]
    epochs = [row["epoch"] for row in rows]
    figure, axes = plt.subplots(1, 2, figsize=(10, 4), layout="constrained")
    for axis, (key, title) in zip(
        axes, (("loss", "Cross-entropy loss"), ("macro_f1", "Macro F1"))
    ):
        axis.plot(epochs, [row["train"][key] for row in rows], label="Train")
        axis.plot(epochs, [row["val"][key] for row in rows], label="Validation")
        axis.axvline(history["best_epoch"], color="0.4", linestyle="--", label="Selected epoch")
        axis.set(xlabel="Epoch", ylabel=title)
        axis.legend()
    figure.suptitle(history["config"]["architecture"])
    figure.savefig(output, dpi=150)
    plt.close(figure)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    args = parser.parse_args()

    checkpoint_path = args.run / "checkpoint.pt"
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    history = json.loads((args.run / "history.json").read_text(encoding="utf-8"))
    config = checkpoint["config"]

    digest = hashlib.sha256(args.manifest.read_bytes()).hexdigest()
    if digest != config["manifest_sha256"]:
        raise ValueError("Manifest does not match the training run")
    samples, class_to_idx = load_image_splits(args.manifest, args.images)
    if class_to_idx != checkpoint["class_to_idx"]:
        raise ValueError("Class mapping does not match the checkpoint")
    if (
        history["config"] != config
        or history["class_to_idx"] != class_to_idx
        or history["best_epoch"] != checkpoint["epoch"]
    ):
        raise ValueError("Training history does not match the checkpoint")

    labels = sorted(class_to_idx, key=class_to_idx.get)
    model = build_image_model(config["architecture"], len(labels)).eval()
    model.load_state_dict(checkpoint["state_dict"])

    validation = evaluate(model, samples["val"], config["batch_size"], labels)
    for metric in ("accuracy", "macro_f1"):
        if abs(validation[metric] - checkpoint["validation"][metric]) > 1e-9:
            raise ValueError(f"Reloaded checkpoint did not reproduce validation {metric}")

    test = evaluate(model, samples["test"], config["batch_size"], labels)
    result = {
        "architecture": config["architecture"],
        "selected_epoch": checkpoint["epoch"],
        "manifest_sha256": digest,
        "class_to_idx": class_to_idx,
        "checkpoint_bytes": checkpoint_path.stat().st_size,
        "validation": validation,
        "test": test,
    }
    (args.run / "evaluation.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    plot_history(history, args.run / "training_curves.png")

    for split in ("validation", "test"):
        scores = result[split]
        print(
            f"{config['architecture']} {split}: n={scores['samples']} "
            f"accuracy={scores['accuracy']:.2%} macro F1={scores['macro_f1']:.2%}"
        )
    print(f"Checkpoint epoch {checkpoint['epoch']}: {result['checkpoint_bytes']:,} bytes")


if __name__ == "__main__":
    main()
