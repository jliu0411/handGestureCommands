# Gesture dataset

## HaGRIDv2 export

The reference dataset is [Gesture Detection Connoisseurs' HaGRID subsets](https://huggingface.co/datasets/GestureDetectionConnoisseurs/hagrid_subsets). The exporter takes the first images per category from upstream's 512px HaGRIDv2 archive and joins their annotations by image ID. The Hugging Face card declares CC BY-SA 4.0. HaGRIDv2 upstream publishes a [modified CC BY-SA 4.0 license](https://github.com/hukenovs/hagrid/blob/master/license/en_us.pdf). Follow upstream terms and preserve attribution for reuse or redistribution. Cite Alexander Kapitanov et al., [HaGRID](https://arxiv.org/abs/2206.08219), the [HaGRIDv2 release](https://github.com/hukenovs/hagrid), and the subset publisher.

Run from the repository root in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m ml.preprocessing.prepare --hagrid-subset 100
```

The ZIP is about 402 MB. Preparation reuses an existing ZIP at `datasets/raw/hagrid-export_100_images.zip` and checks its published SHA-256. It extracts the six selected class directories and the three annotation files into `datasets/raw/hagrid-export_100_images/`. If automatic download fails, download the [100-image ZIP](https://huggingface.co/datasets/GestureDetectionConnoisseurs/hagrid_subsets/resolve/main/hagrid-export_100_images.zip) in your browser or run:

```powershell
New-Item -ItemType Directory -Force datasets/raw | Out-Null
curl.exe --fail --location --retry 3 --output datasets/raw/hagrid-export_100_images.zip "https://huggingface.co/datasets/GestureDetectionConnoisseurs/hagrid_subsets/resolve/main/hagrid-export_100_images.zip?download=true"
.\.venv\Scripts\python.exe -m ml.preprocessing.prepare --hagrid-subset 100
```

The archive contains 3,400 JPEGs in 34 folders. The importer verifies that the names in the six gesture folders match `exported_images.json`, `annotations.json` and `minimal-annotations.json`, and that full and reduced labels and boxes agree. It keeps one target annotation per image. If a second hand is annotated as `no_gesture`, the full-frame MediaPipe result must still match the target hand's box. The box serves as a validation check. Training and webcam inference use the same detector and feature normalization.

All 600 candidate images carried a `user_id` from the full annotations, representing 544 distinct IDs. The export merges source annotation splits, so preparation creates new seeded stratified group splits using these IDs. If only some subject IDs are present, rows without an ID are skipped. If none are available, the importer uses a seeded image-stratified split and the results cannot establish generalization to unseen people. The importer checks exact SHA-256 matches and near matches using a 128-bit perceptual difference hash with a maximum Hamming distance of six before splitting. This check can miss visually similar photos with substantial edits or different framing.

| Gesture | Original | Train | Validation | Test | Usable |
| --- | ---: | ---: | ---: | ---: | ---: |
| palm | 100 | 57 | 19 | 19 | 95 |
| fist | 100 | 57 | 12 | 9 | 78 |
| like | 100 | 50 | 14 | 16 | 80 |
| dislike | 100 | 41 | 15 | 15 | 71 |
| peace | 100 | 64 | 10 | 12 | 86 |
| point | 100 | 47 | 13 | 8 | 68 |
| **Total** | **600** | **316** | **83** | **79** | **478** |

The default run found 529 hands in 600 attempts (88.17%). It discarded 71 no-hand images and 51 target-box mismatches. The source export is a small convenience sample and the detector-based filter favors easier photos.

### Optional 500-image export

Select the [500-image ZIP](https://huggingface.co/datasets/GestureDetectionConnoisseurs/hagrid_subsets/blob/main/hagrid-export_500_images.zip) explicitly (2.03 GB). The commands below regenerate the default local prepared dataset, model and reports. Use `--output`, `--data`, `--model` and `--figures` as appropriate to keep a separate run. To test a model at a non-default location, configure its model and metrics paths in the backend's `.env`.

```powershell
.\.venv\Scripts\python.exe -m ml.preprocessing.prepare --hagrid-subset 500 --per-class 500
.\.venv\Scripts\python.exe -m ml.training.train_random_forest
.\.venv\Scripts\python.exe -m ml.evaluation.evaluate
```

## Import a local subset

For a local subset with original annotation files, arrange the images as `datasets/raw/hagrid/<gesture>/<image-id>.jpg` and the 18 JSON files as `datasets/raw/annotations/<train|val|test>/<gesture>.json`. This import uses single-hand examples, keeps the original splits, and fails if an included subject appears across splits. The six exact labels live in [gesture_config.json](../gesture_config.json). HaGRIDv2 includes separate `one`, `two_up` and `peace_inverted` classes.

From the root, after installing dependencies:

```powershell
.\.venv\Scripts\python.exe -m ml.preprocessing.prepare --images datasets/raw/hagrid --hagrid-annotations datasets/raw/annotations --source "HaGRIDv2; upstream modified CC BY-SA 4.0" --per-class 200
```

Alternatively, use real JPEG or PNG images with a CSV containing `path,label,subject_id,split`. Paths are relative to `--images`. Labels are the six internal class names, and splits are `train`, `val`, and `test`. Preserve the source split wherever possible. Assign each person to exactly one split and use the same pseudonym for all of their images. Use licensed data or consenting participants.

```powershell
.\.venv\Scripts\python.exe -m ml.preprocessing.collect --subject person01 --split train --label palm
.\.venv\Scripts\python.exe -m ml.preprocessing.prepare --images datasets/raw/team --manifest datasets/raw/team_manifest.csv --source "Team webcam collection; participant consent"
```

The collection command saves a frame with Space and exits with Q. Repeat for all six labels and participants assigned to each of the three splits. Vary pose angle, lighting and distance between captures. Use several distinct participants per split for meaningful results.

Preparation writes `landmarks.csv`, `manifest.csv` and `metadata.json` under `datasets/processed/`. The default cap is 200 usable frames per class per split. Every split needs usable examples from all six classes. The manifest records accepted and rejected rows; the metadata records counts, source, preprocessing settings and split strategy. Keep the raw images, ZIP archives, generated dataset and subject IDs out of Git.

Use `--output <directory>` to run preprocessing checks or experiments alongside the reference dataset. Pass that directory's `landmarks.csv` via `--data` when training or evaluating a model from that run. Evaluation verifies that the landmark file matches the hash saved with the model. See the [root README](../README.md#model-evaluation) for the reference results and report locations.
