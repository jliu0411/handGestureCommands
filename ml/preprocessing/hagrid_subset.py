"""Import the public Gesture Detection Connoisseurs HaGRIDv2 exports."""

import hashlib
import json
from pathlib import Path
import re
import shutil
from stat import S_ISLNK
from tempfile import NamedTemporaryFile, TemporaryDirectory
from urllib.error import URLError
from urllib.request import Request, urlopen
from zipfile import ZipFile

import cv2
import numpy as np
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from ml.preprocessing.features import GESTURES

SUBSET_URL = "https://huggingface.co/datasets/GestureDetectionConnoisseurs/hagrid_subsets"
ARCHIVES = {
    100: "72ada2959c117d23e98c8c4da2c9009580554d12163a6db8f78de50312cbdc47",
    500: "f9ce69320543d29f1e15c750b25a421019b2ded7798e6c850b3b203d3ddb0436",
}
ANNOTATION_FILES = {"annotations.json", "minimal-annotations.json", "exported_images.json"}
IMAGE_MEMBER = re.compile(r"([a-z][a-z0-9_]{0,31})/([0-9a-f-]{36}(?:-checkpoint)?)\.jpg")
NEAR_DUPLICATE_DISTANCE = 6


def archive_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def get_archive(raw, size):
    name = f"hagrid-export_{size}_images.zip"
    path = raw / name
    url = f"{SUBSET_URL}/resolve/main/{name}?download=true"
    if not path.exists():
        raw.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url}", flush=True)
        with NamedTemporaryFile(dir=raw, suffix=".part", delete=False) as temporary:
            temporary_path = Path(temporary.name)
        try:
            request = Request(url, headers={"User-Agent": "handGestureCommands-dataset-import/1"})
            with urlopen(request, timeout=90) as response, temporary_path.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            if archive_digest(temporary_path) != ARCHIVES[size]:
                raise ValueError(f"Downloaded {name} does not match the published SHA-256")
            temporary_path.replace(path)
        except (OSError, URLError) as exc:
            raise RuntimeError(f"Download failed. Save {url} to {path} and retry.") from exc
        finally:
            temporary_path.unlink(missing_ok=True)
    if archive_digest(path) != ARCHIVES[size]:
        raise ValueError(f"{path} does not match the published SHA-256. Replace it with the official archive.")
    return path


def archive_members(archive):
    """Allow only the publisher's flat annotation files and class/image paths."""
    selected = {}
    seen = set()
    image_count = 0
    for member in archive.infolist():
        name = member.filename
        if name in seen or S_ISLNK(member.external_attr >> 16):
            raise ValueError(f"Duplicate or symlink archive member: {name}")
        seen.add(name)
        if member.is_dir() and re.fullmatch(r"[a-z][a-z0-9_]{0,31}/", name):
            continue
        if name in ANNOTATION_FILES:
            selected[name] = member
            continue
        match = IMAGE_MEMBER.fullmatch(name)
        if not match:
            raise ValueError(f"Unexpected archive member: {name}")
        image_count += 1
        if match[1] in GESTURES:
            selected[name] = member
    if not ANNOTATION_FILES <= selected.keys():
        raise ValueError("HaGRID export is missing annotation files")
    return selected, image_count


def extract_subset(path, root):
    with ZipFile(path) as archive:
        members, image_count = archive_members(archive)
        if root.exists():
            return image_count
        with TemporaryDirectory(dir=root.parent, prefix="hagrid-import-") as temporary:
            staging = Path(temporary) / "extracted"
            for name, member in members.items():
                destination = staging / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, destination.open("xb") as output:
                    shutil.copyfileobj(source, output)
            staging.rename(root)
        return image_count


def subset_records(root):
    annotations, minimal, indexed = (
        json.loads((root / name).read_text(encoding="utf-8"))
        for name in ("annotations.json", "minimal-annotations.json", "exported_images.json")
    )
    for label in GESTURES:
        paths = {path.stem: path for path in (root / label).glob("*.jpg")}
        ids = indexed[label]
        if (not paths or len(ids) != len(set(ids)) or set(paths) != set(ids)
                or set(paths) != set(annotations[label]) or set(paths) != set(minimal[label])):
            raise ValueError(f"Export index, annotations and images disagree for {label}")
        for image_id in sorted(paths):
            entry = annotations[label][image_id]
            labels, boxes = (entry[key] for key in ("labels", "bboxes"))
            if any(entry[key] != minimal[label][image_id][key] for key in ("labels", "bboxes")):
                raise ValueError(f"Full and minimal annotations disagree for {label}/{image_id}")
            bbox = None
            status = "ambiguous_annotation"
            if (len(labels) == len(boxes) and labels.count(label) == 1
                    and all(value in (label, "no_gesture") for value in labels)):
                bbox = np.asarray(boxes[labels.index(label)], dtype=float)
                if (bbox.shape == (4,) and np.isfinite(bbox).all() and (bbox[:2] >= 0).all()
                        and (bbox[2:] > 0).all() and (bbox[:2] + bbox[2:] <= 1.0001).all()):
                    status = ""
                else:
                    status = "invalid_bbox"
            subject = entry.get("user_id")
            yield {
                "path": paths[image_id].relative_to(root).as_posix(), "label": label,
                "subject_id": subject.strip() if isinstance(subject, str) else "", "split": "",
                "bbox": bbox, "annotation_status": status,
            }


def perceptual_hash(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    horizontal = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    vertical = cv2.resize(gray, (8, 9), interpolation=cv2.INTER_AREA)
    bits = np.concatenate(((horizontal[:, 1:] > horizontal[:, :-1]).ravel(),
                           (vertical[1:, :] > vertical[:-1, :]).ravel()))
    return int.from_bytes(np.packbits(bits).tobytes(), "big")


def assign_subset_splits(rows, seed, use_subjects):
    labels = [row["label"] for row in rows]
    groups = [row["subject_id"] for row in rows] if use_subjects else None
    splitter_type = StratifiedGroupKFold if use_subjects else StratifiedKFold
    splitter = splitter_type(n_splits=6, shuffle=True, random_state=seed)
    for fold, (_, held_out) in enumerate(splitter.split(np.zeros(len(rows)), labels, groups)):
        split = ("test", "val")[fold] if fold < 2 else "train"
        for index in held_out:
            rows[index]["split"] = split
