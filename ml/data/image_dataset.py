"""Image samples from the accepted rows of a prepared gesture manifest."""

import csv
import json
from pathlib import Path

from PIL import Image, ImageOps


SPLITS = ("train", "val", "test")
GESTURE_CONFIG = Path(__file__).resolve().parents[2] / "gesture_config.json"


def load_image_splits(manifest, image_root):
    """Return samples by split and the class indices from the repo config."""
    labels = json.loads(GESTURE_CONFIG.read_text(encoding="utf-8"))
    class_to_idx = {label: index for index, label in enumerate(labels)}
    image_root = Path(image_root).resolve(strict=True)
    samples = {split: [] for split in SPLITS}
    seen_paths = set()
    subject_splits = {}
    missing_subjects = 0

    with Path(manifest).open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        required = {"path", "label", "subject_id", "split", "status"}
        if not required.issubset(reader.fieldnames or ()):
            raise ValueError("Expected path, label, subject_id, split and status in the manifest")

        for row in reader:
            if row["status"] != "ok":
                continue
            split, label = row["split"], row["label"]
            if split not in samples or label not in class_to_idx:
                raise ValueError(f"Invalid split or label on manifest line {reader.line_num}")

            relative_path = Path(row["path"])
            image_path = (image_root / relative_path).resolve()
            if relative_path.is_absolute() or not image_path.is_relative_to(image_root):
                raise ValueError(f"Image path must be relative to the image root: {relative_path}")
            if not image_path.is_file():
                raise FileNotFoundError(image_path)
            if image_path in seen_paths:
                raise ValueError(f"Duplicate accepted image: {relative_path}")
            seen_paths.add(image_path)

            subject = (row["subject_id"] or "").strip()
            if subject:
                if subject_splits.setdefault(subject, split) != split:
                    raise ValueError(f"Subject appears in multiple splits on manifest line {reader.line_num}")
            else:
                missing_subjects += 1
            samples[split].append((image_path, class_to_idx[label]))

    if missing_subjects and subject_splits:
        raise ValueError("Accepted rows must have subject IDs on all images or on none")
    expected_indices = set(class_to_idx.values())
    for split, split_samples in samples.items():
        if {target for _, target in split_samples} != expected_indices:
            raise ValueError(f"The {split} split must contain every configured gesture")

    return samples, class_to_idx


class GestureImageDataset:
    """Map-style dataset for a PyTorch DataLoader."""

    def __init__(self, samples, transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        path, target = self.samples[index]
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        if self.transform is not None:
            image = self.transform(image)
        return image, target
