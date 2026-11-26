import hashlib
import argparse
import csv
import random
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageOps


OUTCOMES = {
    "ok": "Retained",
    "no_hand": "No hand detected",
    "wrong_hand": "Target-hand mismatch",
}


def main():
    parser = argparse.ArgumentParser(description="Audit raw HaGRIDv2 images.")
    parser.add_argument(
        "--manifest", type=Path, default=Path("datasets/processed/manifest.csv")
    )
    parser.add_argument(
        "--raw", type=Path, default=Path("datasets/raw/hagrid-export_100_images")
    )
    parser.add_argument(
        "--figures", type=Path, default=Path("artifacts/figures/eda")
    )
    args = parser.parse_args()

    with args.manifest.open(newline="") as file:
        rows = list(csv.DictReader(file))

    sizes = Counter()
    readable = defaultdict(list)
    missing = 0
    unreadable = 0
    for row in rows:
        filename = Path(row["path"].replace("\\", "/")).name
        path = args.raw / row["label"] / filename
        if not path.is_file():
            missing += 1
            continue

        try:
            with Image.open(path) as image:
                image.load()
                sizes[image.size] += 1
        except (OSError, ValueError):
            unreadable += 1
            continue

        readable[(row["label"], row["status"])].append(path)

    print(f"Candidates: {len(rows)}")
    print(f"Readable: {sum(sizes.values())}")
    print(f"Missing: {missing}")
    print(f"Unreadable: {unreadable}")
    print(f"Distinct resolutions: {len(sizes)}")

    if missing:
        raise SystemExit("Check the manifest filenames and the --raw directory.")
    if not sizes:
        raise SystemExit("No readable images were found.")
    
    images_by_hash = defaultdict(list)
    for row in rows:
        filename = Path(row["path"].replace("\\", "/")).name
        path = args.raw / row["label"] / filename
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            images_by_hash[digest].append(row)

    duplicate_groups = [
        group for group in images_by_hash.values() if len(group) > 1
    ]
    conflicting_labels = sum(
        len({row["label"] for row in group}) > 1
        for group in duplicate_groups
    )
    cross_split_groups = sum(
        len({row["split"] for row in group if row["status"] == "ok"}) > 1
        for group in duplicate_groups
    )

    print("\nDuplicate audit")
    print(f"Exact duplicate groups: {len(duplicate_groups)}")
    print(f"Exact duplicate groups with conflicting labels: {conflicting_labels}")
    print(f"Exact duplicate groups spanning retained splits: {cross_split_groups}")
    print(f"Manifest rows linked to a duplicate: {sum(bool(row['duplicate_of'].strip()) for row in rows)}")

    subject_counts = {
        split: len({
            row["subject_id"].strip()
            for row in rows
            if row["status"] == "ok"
            and row["split"] == split
            and row["subject_id"].strip()
        })
        for split in ("train", "val", "test")
    }
    print(f"Distinct retained subjects by split: {subject_counts}")

    args.figures.mkdir(parents=True, exist_ok=True)
    most_common = sizes.most_common(12)
    labels = [f"{width} × {height}" for (width, height), _ in most_common]
    counts = [count for _, count in most_common]
    remaining = sum(sizes.values()) - sum(counts)
    if remaining:
        labels.append("All other resolutions")
        counts.append(remaining)

    for label, count in zip(labels, counts):
        print(f"  {label}: {count}")

    figure, ax = plt.subplots(figsize=(9, 5))
    ax.barh(labels, counts)
    ax.invert_yaxis()
    ax.set(title="Raw image resolutions", xlabel="Readable images")
    figure.savefig(
        args.figures / "image_resolutions.png", dpi=180, bbox_inches="tight"
    )
    plt.close(figure)

    gestures = sorted({row["label"] for row in rows})
    figure, axes = plt.subplots(
        len(gestures), len(OUTCOMES), figsize=(9, 2.3 * len(gestures)), squeeze=False
    )
    rng = random.Random(42)
    for row_index, gesture in enumerate(gestures):
        for column_index, (status, outcome) in enumerate(OUTCOMES.items()):
            ax = axes[row_index][column_index]
            ax.set_title(f"{gesture} · {outcome}", fontsize=9)
            ax.set_axis_off()
            candidates = sorted(readable[(gesture, status)])
            if candidates:
                with Image.open(rng.choice(candidates)) as image:
                    ax.imshow(ImageOps.exif_transpose(image).convert("RGB"))
            else:
                ax.text(0.5, 0.5, "No readable examples", ha="center", va="center")

    figure.tight_layout()
    figure.savefig(
        args.figures / "gesture_examples.png", dpi=180, bbox_inches="tight"
    )
    plt.close(figure)
    print(f"Saved both figures under {args.figures}")


if __name__ == "__main__":
    main()
