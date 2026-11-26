# Exploratory Data Analysis

## Dataset and preprocessing

The reference experiment uses six gestures from the Gesture Detection
Connoisseurs HaGRIDv2 100-image export: `dislike`, `fist`, `like`, `palm`,
`peace`, and `point`. Each gesture contributed 100 candidate images.
See [dataset source and attribution](../../datasets/README.md).

On macOS Apple Silicon, MediaPipe detected a hand in 530 of 600 images
(88.3%). Preprocessing retained 479 images (79.8%), excluded 70 images
with no detected hand, and excluded 51 for target-hand mismatch.
The repository's documented reference run retained 478 images. The
figures and counts in this report describe the macOS run.

| Gesture | Retained | No hand detected | Target-hand mismatch | Train | Validation | Test |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dislike | 71 | 18 | 11 | 57 | 9 | 5 |
| fist | 78 | 12 | 10 | 50 | 19 | 9 |
| like | 80 | 12 | 8 | 46 | 17 | 17 |
| palm | 95 | 3 | 2 | 63 | 18 | 14 |
| peace | 86 | 10 | 4 | 62 | 11 | 13 |
| point | 69 | 15 | 16 | 40 | 11 | 18 |
| **Total** | **479** | **70** | **51** | **318** | **85** | **76** |

Class counts were equal before filtering. Retention ranged from 69% for
`point` to 95% for `palm`, a 26 percentage-point gap. Test counts ranged
from 5 to 18 per class, which limits the precision of per-gesture
performance estimates.

## Image quality, duplicates, and subject overlap

All 600 candidate images decoded successfully. The raw images had
39 distinct stored resolutions. The most frequent was 512 × 683 pixels,
with 371 images (61.8%). The gesture grid shows one sampled image per
gesture and preprocessing outcome where available. It supports
qualitative inspection of framing, occlusion, and visible hands.

The SHA-256 audit found zero exact duplicate groups among the 600
candidates. The preprocessing manifest contained zero rows linked to a
duplicate. All retained rows had a subject ID and a split. Training,
validation, and test contained 297, 75, and 75 distinct subject IDs,
respectively, with zero IDs shared across splits. Subject identifiers and
hash-based checks can miss unrecorded identities or visually similar
images.

## Metadata and limitations

The export's annotation records with a subject ID contained age, gender,
and race fields. Demographic coverage was not quantified for the selected
600 images. No explicit background or lighting fields were found in the
inspected annotations, so coverage across those conditions could not be
quantified from metadata.

The export is a small convenience sample. Detector-based filtering can
favor images whose hand poses and framing are easier to detect. The
resulting class mix and still-image evaluation limit what the findings
say about live webcam use.

## Figures and reproduction

- [Preprocessing outcomes by gesture](../../artifacts/figures/eda/preprocessing_outcomes.png)
- [Raw image resolutions](../../artifacts/figures/eda/image_resolutions.png)
- [Gesture examples by preprocessing outcome](../../artifacts/figures/eda/gesture_examples.png)
- [Retained class counts by split](../../artifacts/figures/eda/retained_class_counts_by_split.png)

From the repository root, using the Python 3.11 EDA environment:

```bash
.cache/eda-venv/bin/python -m ml.preprocessing.prepare --hagrid-subset 100
.cache/eda-venv/bin/python -m ml.evaluation.eda
.cache/eda-venv/bin/python -m ml.evaluation.eda_images
```