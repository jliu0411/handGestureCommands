"""Measure batch-one CPU inference on decoded validation images."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import platform
from statistics import median, quantiles
from time import perf_counter_ns

import torch

from ml.data.image_dataset import GestureImageDataset, load_image_splits
from ml.data.image_transforms import build_image_transform
from ml.models.image_classifiers import build_image_model


WARMUPS = 10
CONFIDENCE_THRESHOLD = 0.70


def predict(model, transform, labels, image):
    probabilities = model(transform(image).unsqueeze(0)).softmax(dim=1)
    score, index = probabilities[0].max(dim=0)
    confidence = score.item()
    gesture = labels[index.item()] if confidence >= CONFIDENCE_THRESHOLD else "unknown"
    return gesture, confidence


@torch.inference_mode()
def benchmark(model, dataset, labels):
    transform = build_image_transform()
    for index in range(WARMUPS):
        image, _ = dataset[index % len(dataset)]
        predict(model, transform, labels, image)

    durations = []
    outcomes = Counter(classified=0, unknown=0)
    for image, _ in dataset:
        start = perf_counter_ns()
        gesture, _ = predict(model, transform, labels, image)
        durations.append((perf_counter_ns() - start) / 1_000_000)
        outcomes["unknown" if gesture == "unknown" else "classified"] += 1

    return {
        "timed_predictions": len(durations),
        "median_ms": round(median(durations), 3),
        "p95_ms": round(quantiles(durations, n=100, method="inclusive")[94], 3),
        "outcomes": dict(outcomes),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    args = parser.parse_args()

    torch.set_num_threads(1)
    checkpoint = torch.load(args.run / "checkpoint.pt", map_location="cpu", weights_only=True)
    config = checkpoint["config"]
    digest = hashlib.sha256(args.manifest.read_bytes()).hexdigest()
    if digest != config["manifest_sha256"]:
        raise ValueError("Manifest does not match the training run")

    samples, class_to_idx = load_image_splits(args.manifest, args.images)
    if class_to_idx != checkpoint["class_to_idx"]:
        raise ValueError("Class mapping does not match the checkpoint")

    labels = sorted(class_to_idx, key=class_to_idx.get)
    model = build_image_model(config["architecture"], len(labels)).eval()
    model.load_state_dict(checkpoint["state_dict"])

    result = {
        "architecture": config["architecture"],
        "selected_epoch": checkpoint["epoch"],
        "manifest_sha256": digest,
        "platform": platform.platform(),
        "python": platform.python_version(),
        "torch_version": str(torch.__version__),
        "device": "cpu",
        "torch_threads": torch.get_num_threads(),
        "scope": "Decoded RGB image to gesture and confidence, including input transforms",
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "warmup_predictions": WARMUPS,
        **benchmark(model, GestureImageDataset(samples["val"]), labels),
    }
    report = args.run / "inference_latency.json"
    report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        f"{result['architecture']}: n={result['timed_predictions']}, "
        f"median={result['median_ms']:.3f} ms, p95={result['p95_ms']:.3f} ms"
    )


if __name__ == "__main__":
    main()
