import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import ConfusionMatrixDisplay, classification_report, confusion_matrix

from ml.preprocessing.features import GESTURES


def write_metrics(model, features, labels, split, output, model_id, figures, *, selection=None):
    output.mkdir(parents=True, exist_ok=True)
    figures.mkdir(parents=True, exist_ok=True)
    predicted = model.predict(features)
    classes = list(GESTURES)
    report = classification_report(labels, predicted, labels=classes, output_dict=True, zero_division=0)
    matrix = confusion_matrix(labels, predicted, labels=classes)
    metrics = {
        "model_name": "random_forest", "model_id": model_id, "split": split,
        "samples": len(labels), "accuracy": report["accuracy"], "macro": report["macro avg"],
        "per_class": {label: report[label] for label in classes},
        "labels": classes, "confusion_matrix": matrix.tolist(), "model_params": model.get_params(),
    }
    if selection is not None:
        metrics["selection"] = selection
    for name, data in (("classification_report", report), ("model_metrics", metrics)):
        (output / f"{name}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    figure, axes = plt.subplots(figsize=(7, 6), layout="constrained")
    ConfusionMatrixDisplay(matrix, display_labels=classes).plot(ax=axes, colorbar=False, cmap="Blues")
    axes.set_title(f"{split.capitalize()} confusion matrix")
    figure.savefig(figures / "confusion_matrix.png", dpi=150)
    plt.close(figure)
    print(json.dumps(metrics, indent=2))


def plot_class_distribution(data, output):
    output.mkdir(parents=True, exist_ok=True)
    figure, axes = plt.subplots(figsize=(8, 4), layout="constrained")
    counts = data.groupby(["label", "split"]).size().unstack(fill_value=0)
    counts.reindex(list(GESTURES))[["train", "val", "test"]].plot.bar(
        ax=axes, rot=0, color=["#295d87", "#458877", "#b27234"],
    )
    axes.set(xlabel="Gesture", ylabel="Usable images", title="Gesture samples by split")
    figure.savefig(output / "class_distribution.png", dpi=150)
    plt.close(figure)
