from copy import deepcopy
import json
from types import SimpleNamespace
from zipfile import ZipFile

import numpy as np
import pytest

from ml.preprocessing.features import GESTURES, HandDetector, HandOutsideBox
from ml.preprocessing.hagrid_subset import archive_members, assign_subset_splits, subset_records


def test_reject_unsafe_archive_path(tmp_path):
    path = tmp_path / "subset.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("../outside.jpg", b"")
    with ZipFile(path) as archive, pytest.raises(ValueError, match="Unexpected archive member"):
        archive_members(archive)


def test_read_target_annotation_and_reject_index_mismatch(tmp_path):
    image_id = "12345678-1234-1234-1234-123456789012"
    annotations = {}
    minimal = {}
    exported = {}
    for label in GESTURES:
        directory = tmp_path / label
        directory.mkdir()
        (directory / f"{image_id}.jpg").touch()
        entry = {"labels": ["no_gesture", label], "bboxes": [[0.1, 0.2, 0.1, 0.2], [0.6, 0.3, 0.2, 0.3]]}
        annotations[label] = {image_id: {**entry, "user_id": "source-subject"}}
        minimal[label] = {image_id: entry}
        exported[label] = [image_id]
    for name, contents in (("annotations", annotations), ("minimal-annotations", minimal), ("exported_images", exported)):
        (tmp_path / f"{name}.json").write_text(json.dumps(contents), encoding="utf-8")
    rows = list(subset_records(tmp_path))
    assert len(rows) == len(GESTURES)
    assert all(row["subject_id"] == "source-subject" and row["annotation_status"] == "" for row in rows)
    np.testing.assert_array_equal(rows[0]["bbox"], [0.6, 0.3, 0.2, 0.3])

    exported["palm"].clear()
    (tmp_path / "exported_images.json").write_text(json.dumps(exported), encoding="utf-8")
    with pytest.raises(ValueError, match="disagree for palm"):
        list(subset_records(tmp_path))


@pytest.mark.parametrize("use_subjects", [True, False])
def test_seeded_split(use_subjects):
    rows = [{"label": label, "subject_id": str(subject) if use_subjects else ""}
            for subject in range(24) for label in GESTURES]
    repeated = deepcopy(rows)
    assign_subset_splits(rows, 42, use_subjects)
    assign_subset_splits(repeated, 42, use_subjects)
    assert rows == repeated
    for split in ("train", "val", "test"):
        assert {row["label"] for row in rows if row["split"] == split} == set(GESTURES)
    if use_subjects:
        subjects = {}
        for row in rows:
            assert subjects.setdefault(row["subject_id"], row["split"]) == row["split"]


def test_annotation_checks_target_without_changing_features():
    detector = HandDetector.__new__(HandDetector)
    landmarks = [SimpleNamespace(x=0.3 + index * 0.01, y=0.4, z=0.001 * index) for index in range(21)]
    detector.hands = SimpleNamespace(process=lambda _: SimpleNamespace(
        multi_hand_landmarks=[SimpleNamespace(landmark=landmarks)],
    ))
    image = np.zeros((48, 64, 3), dtype=np.uint8)
    np.testing.assert_array_equal(detector.extract(image), detector.extract(image, [0.25, 0.35, 0.3, 0.2]))
    with pytest.raises(HandOutsideBox):
        detector.extract(image, [0.65, 0.65, 0.3, 0.2])
