import argparse
import csv
from pathlib import Path
from time import monotonic
import uuid

import cv2

from ml.preprocessing.features import GESTURES
from ml.preprocessing.prepare import FIELDS, SPLITS


def main():
    parser = argparse.ArgumentParser(description="Collect consenting participants' labeled webcam frames")
    parser.add_argument("--images", default=Path("datasets/raw/team"), type=Path)
    parser.add_argument("--manifest", default=Path("datasets/raw/team_manifest.csv"), type=Path)
    parser.add_argument("--subject", required=True, help="Stable pseudonym for the participant")
    parser.add_argument("--split", required=True, choices=SPLITS)
    parser.add_argument("--label", required=True, choices=GESTURES)
    parser.add_argument("--camera", default=0, type=int)
    args = parser.parse_args()
    if not args.subject.strip():
        parser.error("Provide a nonempty pseudonym")

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    if args.manifest.is_file():
        with args.manifest.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                if row["subject_id"] == args.subject and row["split"] != args.split:
                    parser.error("This participant is already assigned to another split")

    directory = args.images / args.label
    directory.mkdir(parents=True, exist_ok=True)
    camera = cv2.VideoCapture(args.camera)
    last_capture = -1.0
    try:
        if not camera.isOpened():
            raise RuntimeError("Unable to open webcam")
        with args.manifest.open("a", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            if handle.tell() == 0:
                writer.writeheader()
            while True:
                ok, frame = camera.read()
                if not ok:
                    raise RuntimeError("Unable to read webcam")
                preview = cv2.flip(frame, 1)
                cv2.putText(preview, f"{GESTURES[args.label]['name']} | Space: save  Q: quit",
                            (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
                cv2.imshow("Collect gesture examples", preview)
                key = cv2.waitKey(1) & 0xff
                if key in (ord("q"), 27):
                    break
                if key == 32 and monotonic() - last_capture >= 0.5:
                    path = directory / f"{uuid.uuid4().hex}.jpg"
                    if not cv2.imwrite(str(path), frame):
                        raise RuntimeError(f"Unable to save {path}")
                    writer.writerow(dict(zip(FIELDS, (
                        path.relative_to(args.images).as_posix(), args.label, args.subject, args.split,
                    ))))
                    handle.flush()
                    last_capture = monotonic()
                    print(f"Saved {path}")
    finally:
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
