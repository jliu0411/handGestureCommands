# Repository cleanup audit

The audit covers the working tree, including local data and generated files. Git status identifies tracked files and distinguishes ignored local files from extension source and tests awaiting their first commit. The review used the three available commits, source and configuration references, installed dependency metadata, and hashes of the local dataset outputs.

## Files and directories

| File or directory | Git status before cleanup | Purpose | Recommended action | Reason |
| --- | --- | --- | --- | --- |
| Root and frontend `.env.example` | Tracked | Document local configuration | Keep | FastAPI reads root `.env`, and Vite loads frontend variables. Both examples contain defaults. No live environment file is tracked. |
| `.gitignore` | Tracked | Exclude local data and generated files | Update | Add extension output and cache patterns while keeping both examples, the model, and evaluation results eligible. |
| `.github/workflows/` | Tracked placeholder | Reserved CI directory | Keep for review | It contains only `.gitkeep`. Any future workflow can be added here. |
| `backend/app/main.py`, `backend/app/schemas/prediction.py`, `backend/tests/` | Tracked, with the new finger-count test untracked | API, response schema, and backend tests | Keep | Referenced by the Uvicorn entry point, both clients, and the test suite. |
| `ml/inference/`, `ml/preprocessing/`, `ml/training/`, `ml/evaluation/` | Tracked, with the new finger-count module untracked | Live inference, dataset preparation, training, and evaluation | Keep | Imports and documented CLI flows use these modules. The webcam collector is a documented optional source of labeled images. |
| `frontend/src/`, `frontend/index.html`, `frontend/vite.config.js`, `frontend/package.json`, `frontend/package-lock.json` | Tracked | React demo, dev proxy, and deterministic installation | Keep | Needed for the demo, tests, and `npm ci`. |
| `gesture_config.json` | Tracked | Random Forest labels and React demo actions | Keep | Shared by Python feature metadata and React. |
| `browser-extension/` | Untracked | Manifest V3 side panel, camera, service worker, dispatcher, content controller, diagnostics, and tests | Keep | These are the extension's current source and verification fixtures. The manifest and HTML files name the entry points. |
| `isBrowserCommand` in `browser-extension/config.js` and its worker call | Untracked | Validates incoming command names | Narrow to one-shot names | The dispatcher already converts UI scroll labels to start/update messages. The worker's separate scroll branch handles those messages. The content script has no handler for the raw labels. |
| Standalone flick detector, motion thresholds, or direction-tracking implementation | Absent | Former browser gesture implementation | No deletion | No matching implementation or reference was found in the checkout or available history. The stationary scroll policy, controller, and diagnostics are active. |
| `artifacts/models/random_forest.joblib` | Tracked | Reference model loaded at API startup | Keep | The trained model is required for the default app. |
| `artifacts/metrics/`, `artifacts/figures/` | Tracked | Validation/test reports, confusion matrices, and class distribution | Keep | The backend reads saved metrics by model ID and the figures support the academic evaluation. No temporary model output was found. |
| `datasets/raw/` and the HaGRID archive | Ignored | Original reference images and annotations | Keep | The importer pins a checksum and documents the source. Preserving the local copy avoids a large download and supports offline reproduction. |
| `datasets/processed/{landmarks.csv,manifest.csv,metadata.json}` | Ignored | Reference landmarks, split records, and provenance | Keep | Training/evaluation use these files. The saved model records the landmark hash. |
| `datasets/processed/reproducibility-check/` | Ignored | Second preparation run | Delete the duplicate | All three files had SHA-256 hashes identical to their canonical counterparts. No code or docs use the duplicate path. Recreate with `python -m ml.preprocessing.prepare --hagrid-subset 100 --output datasets/processed/reproducibility-check`. |
| `.pytest_cache/` and project-source `__pycache__/` | Ignored | Test and Python bytecode caches | Delete | Reproducible through pytest and Python imports. Virtual-environment caches remain inside their environments. |
| `.venv/`, `.venv-python/`, and the `.lock` files inside them | Ignored | Local Python environments and their environment-local lock markers | Keep | The environments may still be in use. The zero-byte locks are contained inside them. There is no root `.lock`. |
| `frontend/node_modules/` | Ignored | Installed JavaScript dependencies | Keep | Required for current local use. The lockfile and `npm ci` can reproduce the installation. |
| `frontend/dist/`, `browser-extension/dist/`, extension packages, temporary screenshots and logs | Absent | Generated outputs or transient evidence | Ignore applicable paths | The Vite build is reproducible. Chrome loads the extension source directly. No existing output or debug file needs removal. |
| `docker-compose.yml` | Tracked | Planned deployment placeholder | Delete | It contains only a comment, defines no services, and has no references. Document the working local setup in `deployment/README.md`. |
| `.gitkeep` in populated directories | Tracked | Previously kept those directories in Git | Delete | Source files, tests, or evaluation artifacts now keep their parent paths in Git. |
| Empty directories reserved for scripts, architecture, deployment, or coursework | Tracked placeholders | Project scaffolding | Keep for review | The checkout cannot establish whether these paths are expected for grading. |
| `docs/crisp_dm/README.md`, `docs/report/README.md`, `docs/presentation/README.md` | Tracked | Coursework outlines | Keep | These are planning outlines. No finished report, slides, or demo video was found. |

## Dependency audit

| Files | Git status | Purpose | Recommended action | Reason |
| --- | --- | --- | --- | --- |
| `backend/requirements.txt` | Tracked | API runtime and test tools | Keep the existing pins | FastAPI, Pydantic and python-dotenv are imported, Uvicorn starts the API, pytest runs tests, and Starlette's `TestClient` uses HTTPX. |
| `ml/requirements.txt` | Tracked | MediaPipe/OpenCV, feature extraction, training and reporting | Keep the existing pins | Every package is imported or required by a pinned dependency. Installed MediaPipe declares both JAX and jaxlib. Their pins keep a compatible NumPy 1.26 environment. |
| `frontend/package.json` and `package-lock.json` | Tracked | React, DOM rendering and Vite | Keep | Frontend source imports React and React DOM, and the scripts use Vite. Node's built-in runner handles tests. |
| Extension dependencies | No package manifest or lockfile | Chrome API and browser JavaScript | No change | Runtime uses Chrome APIs and tests use Node's standard library. |

`python -m pip check` reported no broken requirements in the active environment. Git listed no tracked caches, datasets, generated builds, or live environment files, so no index removals are needed.

## Cleanup record

- Removed the comment-only `docker-compose.yml` and twelve redundant `.gitkeep` files. Their parent directories are `artifacts/figures`, `artifacts/metrics`, `artifacts/models`, `backend/app/schemas`, `backend/tests`, `frontend/src/hooks`, `frontend/src/pages`, `frontend/src/services`, `ml/evaluation`, `ml/inference`, `ml/preprocessing`, and `ml/training`.
- Removed the ignored duplicate at `datasets/processed/reproducibility-check/`, `.pytest_cache/`, and the five project-source `__pycache__/` directories under `backend/app`, `backend/app/schemas`, `backend/tests`, `ml/inference`, and `ml/preprocessing`.
- Removed the unused raw scroll labels from the worker's accepted messages. Scrolling still uses the dispatcher's start, update, and stop messages. The original labels remain in the UI and gesture mappings.
- Re-ran dataset preparation, training, and evaluation in a temporary directory. The regenerated landmarks matched the reference SHA-256, and both splits matched their saved sample counts, accuracy, and macro F1. The checked-in model kept its original hash.
