# AI-Powered Real-Time Hand Gesture Recognition System

Group final project skeleton for an end-to-end computer vision application.

## Goal
Recognize hand gestures from webcam images and translate recognized gestures into simple application commands.

## Proposed stack
- Frontend: React + Vite
- Backend: FastAPI
- ML: PyTorch, scikit-learn, MediaPipe
- Experiment tracking: MLflow
- Packaging/deployment: Docker + a cloud provider

## Repository layout
- `frontend/` — React webcam UI, predictions and dashboards
- `backend/` — FastAPI inference endpoints and tests
- `ml/` — preprocessing, training, experiments and inference
- `datasets/` — dataset references and download instructions
- `artifacts/` — figures, metrics and selected model artifacts
- `docs/crisp_dm/` — methodology artifacts
- `docs/report/` — final research paper
- `docs/presentation/` — slides and demo video information
- `deployment/` — Docker and cloud deployment setup
- `scripts/` — setup, training and evaluation scripts

## Suggested first tasks
1. Choose an RGB webcam-compatible gesture dataset, verify its license, and map labels.
2. Establish reproducible subject-aware train/validation/test splits.
3. Train and evaluate a landmark-based baseline model.
4. Connect FastAPI inference to the React webcam interface.
5. Compare the baseline with CNN/MobileNet and generate evaluation metrics.

> This download is a **folder skeleton only**. It does not yet contain an implemented or executable application.
