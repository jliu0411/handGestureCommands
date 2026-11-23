import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import warnings

import pandas as pd

from ml.preprocessing.features import FEATURES, GESTURES, PREPROCESSING, HandDetector, HandOutsideBox
from ml.preprocessing.hagrid_subset import (
    ARCHIVES, NEAR_DUPLICATE_DISTANCE, SUBSET_URL, assign_subset_splits, extract_subset,
    get_archive, perceptual_hash, subset_records,
)
from ml.preprocessing.images import decode_image

SPLITS = ("train", "val", "test")
FIELDS = ("path", "label", "subject_id", "split")


def hagrid_records(root, annotations):
    for split in SPLITS:
        for label in GESTURES:
            catalog = json.loads((annotations / split / f"{label}.json").read_text(encoding="utf-8"))
            for image_id, entry in catalog.items():
                # Single annotated hand prevents assigning the target label to a second hand.
                if entry.get("labels") != [label] or len(entry.get("bboxes", [])) != 1:
                    continue
                path = Path(label) / f"{image_id}.jpg"
                if (root / path).is_file():
                    yield dict(zip(FIELDS, (path.as_posix(), label, entry.get("user_id") or "", split)))


def validated_records(rows, root, *, allow_unsplit=False):
    subjects = {}
    paths = set()
    for row in rows:
        path, label, subject, split = (str(row[field]).strip() for field in FIELDS)
        if label not in GESTURES or (not allow_unsplit and (split not in SPLITS or not subject)):
            raise ValueError(f"Invalid label, subject_id or split for {path}")
        resolved = (root / path).resolve()
        if Path(path).is_absolute() or not resolved.is_relative_to(root) or resolved in paths:
            raise ValueError(f"Invalid or duplicate image path: {path}")
        if subjects.setdefault(subject, split) != split:
            raise ValueError(f"Subject appears in multiple splits: {subject}")
        paths.add(resolved)
        yield {**row, **dict(zip(FIELDS, (resolved.relative_to(root).as_posix(), label, subject, split)))}


def prepare(root, output, records, source, per_class, seed, subset=None):
    root = root.resolve()
    rows = list(validated_records(records, root, allow_unsplit=subset is not None))
    rows.sort(key=lambda row: hashlib.sha256(f"{seed}:{row['path']}".encode()).digest())
    subject_count = len({row["subject_id"] for row in rows if row["subject_id"]})
    missing_subjects = sum(not row["subject_id"] for row in rows)
    use_subjects = subset is None or subject_count > 0
    counts = Counter()
    hashes = {}
    visual_hashes = []
    detections = Counter()
    usable = []
    detector = HandDetector()
    try:
        for row in rows:
            group = (row["split"], row["label"])
            if subset is None and counts[group] >= per_class:
                row["status"] = "cap"
                continue
            if row.get("annotation_status"):
                row["status"] = row["annotation_status"]
                continue
            if use_subjects and not row["subject_id"]:
                row["status"] = "missing_subject"
                continue
            path = root / row["path"]
            try:
                content = path.read_bytes()
                digest = hashlib.sha256(content).hexdigest()
                previous = hashes.get(digest)
                if previous is not None:
                    if subset is None and (previous["split"], previous["label"]) != group:
                        raise RuntimeError(f"Identical image in different splits or classes: {path}")
                    row["status"] = "duplicate"
                    row["duplicate_of"] = previous["path"]
                    continue
                image = decode_image(content)
                if subset is not None:
                    fingerprint = perceptual_hash(image)
                    duplicate = next((other for other_hash, other in visual_hashes
                                      if (fingerprint ^ other_hash).bit_count()
                                      <= NEAR_DUPLICATE_DISTANCE), None)
                    if duplicate is not None:
                        row["status"] = "near_duplicate"
                        row["duplicate_of"] = duplicate["path"]
                        continue
                    visual_hashes.append((fingerprint, row))
                hashes[digest] = row
            except (OSError, ValueError) as exc:
                row["status"] = "invalid_image"
                warnings.warn(f"Skipping {row['path']}: {exc}", stacklevel=2)
                continue
            detections["attempted"] += 1
            try:
                vector = detector.extract(image, expected_bbox=row.get("bbox"))
            except HandOutsideBox:
                row["status"] = "wrong_hand"
                detections["found"] += 1
                continue
            except ValueError:
                row["status"] = "invalid_landmarks"
                detections["found"] += 1
                continue
            if vector is None:
                row["status"] = "no_hand"
                continue
            detections["found"] += 1
            row["status"] = "ok"
            row["features"] = vector
            usable.append(row)
            if subset is None:
                counts[group] += 1
    finally:
        detector.close()
    if subset is not None and usable:
        assign_subset_splits(usable, seed, use_subjects)
        for row in usable:
            group = (row["split"], row["label"])
            if counts[group] >= per_class:
                row["status"] = "cap"
            else:
                counts[group] += 1
    accepted = [row for row in usable if row["status"] == "ok"]
    output.mkdir(parents=True, exist_ok=True)
    (output / "landmarks.csv").unlink(missing_ok=True)
    pd.DataFrame(rows, columns=[*FIELDS, "status", "duplicate_of"]).to_csv(
        output / "manifest.csv", index=False,
    )
    summary = {
        "source": source, "seed": seed, "cap_per_class_per_split": per_class,
        "candidate_count": len(rows), "candidate_counts_by_class": dict(Counter(row["label"] for row in rows)),
        "usable_images": len(accepted), "discarded_images": len(rows) - len(accepted),
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "counts": {split: {label: counts[split, label] for label in GESTURES} for split in SPLITS},
        "split_sizes": {split: sum(counts[split, label] for label in GESTURES) for split in SPLITS},
        "split_strategy": "subject_disjoint" if use_subjects else "image_stratified",
        "subject_ids": {
            "unique_candidates": subject_count, "missing_candidates": missing_subjects,
            "unique_by_split": {
                split: len({row["subject_id"] for row in accepted if row["split"] == split
                            and row["subject_id"]}) for split in SPLITS
            },
        },
        "mediapipe": {
            "attempted": detections["attempted"], "hand_detected": detections["found"],
            "detection_rate": detections["found"] / detections["attempted"] if detections["attempted"] else None,
        },
        "preprocessing": PREPROCESSING, "classes": GESTURES,
    }
    if subset is not None:
        summary["archive"] = subset
    (output / "metadata.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    missing = [f"{split}/{label}" for split in SPLITS for label in GESTURES if not counts[split, label]]
    if missing:
        raise ValueError(f"No usable examples for {', '.join(missing)}. See manifest.csv and metadata.json.")
    features = [{**row, **dict(zip(FEATURES, map(float, row["features"])))} for row in accepted]
    pd.DataFrame(features, columns=[*FIELDS, *FEATURES]).to_csv(output / "landmarks.csv", index=False)
    print(json.dumps({key: summary[key] for key in ("split_sizes", "counts", "status_counts", "mediapipe")},
                     indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Prepare gesture landmarks and reproducible splits")
    parser.add_argument("--images", type=Path, help="Image root for a local annotation or CSV import")
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--hagrid-subset", type=int, choices=ARCHIVES)
    inputs.add_argument("--hagrid-annotations", type=Path)
    inputs.add_argument("--manifest", type=Path)
    parser.add_argument("--source", help="Dataset name, version, license/consent reference for local imports")
    parser.add_argument("--raw", type=Path, default=Path("datasets/raw"), help="HaGRID subset archive directory")
    parser.add_argument("--output", type=Path, default=Path("datasets/processed"))
    parser.add_argument("--per-class", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.per_class < 1:
        parser.error("--per-class must be positive")
    if args.hagrid_subset:
        if args.images or args.source:
            parser.error("--hagrid-subset sets its own image root and source. Use --raw to set the archive directory.")
        size = args.hagrid_subset
        archive = get_archive(args.raw, size)
        images = args.raw / archive.stem
        original_count = extract_subset(archive, images)
        prepare(images, args.output, subset_records(images), SUBSET_URL, args.per_class, args.seed, subset={
            "name": archive.name, "sha256": ARCHIVES[size], "original_images": original_count,
            "near_duplicate_max_bits": NEAR_DUPLICATE_DISTANCE,
        })
        return
    if args.images is None or not args.images.is_dir() or not args.source:
        parser.error("Local imports require --images and --source")
    if args.manifest:
        records = pd.read_csv(args.manifest, dtype=str, keep_default_na=False).to_dict("records")
    else:
        records = hagrid_records(args.images, args.hagrid_annotations)
    prepare(args.images, args.output, records, args.source, args.per_class, args.seed)


if __name__ == "__main__":
    main()
