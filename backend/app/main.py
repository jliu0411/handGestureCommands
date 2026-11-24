from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from backend.app.schemas.prediction import Prediction
from ml.inference.service import GestureService
from ml.preprocessing.features import GESTURES, ROOT
from ml.preprocessing.images import IMAGE_TYPES, decode_image

log = logging.getLogger(__name__)
load_dotenv(ROOT / ".env")


def create_app(model_path=None, metrics_dir=None, service_loader=GestureService.load):
    model_path = Path(model_path or os.getenv("GESTURE_MODEL_PATH", "artifacts/models/random_forest.joblib"))
    metrics_dir = Path(metrics_dir or os.getenv("GESTURE_METRICS_DIR", "artifacts/metrics"))
    threshold = float(os.getenv("GESTURE_CONFIDENCE_THRESHOLD", "0.70"))
    max_bytes = int(os.getenv("GESTURE_MAX_FRAME_BYTES", "2097152"))
    if not 0 <= threshold <= 1 or max_bytes <= 0:
        raise ValueError("Invalid gesture threshold or frame size limit")

    @asynccontextmanager
    async def lifespan(app):
        app.state.service = None
        app.state.model_error = None
        try:
            app.state.service = service_loader(ROOT / model_path, threshold)
        except FileNotFoundError:
            app.state.model_error = "Model file missing. Prepare data and train the Random Forest, then restart."
        except Exception:
            log.exception("Model initialization failed")
            app.state.model_error = "Model initialization failed. Check server logs and artifact compatibility."
        try:
            yield
        finally:
            if app.state.service is not None:
                app.state.service.close()

    app = FastAPI(title="Hand Gesture Recognition", lifespan=lifespan)
    origins = os.getenv("GESTURE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in origins.split(",")],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.get("/health")
    def health():
        ready = app.state.service is not None
        return {"status": "ok" if ready else "degraded", "model_ready": ready,
                "model_error": app.state.model_error}

    @app.get("/models")
    def models():
        service = app.state.service
        return {"model_name": "random_forest", "loaded": service is not None,
                "model_id": service.model_id if service else None,
                "confidence_threshold": threshold, "gestures": GESTURES,
                "capabilities": {"hand_center": True, "finger_count": True}}

    @app.get("/metrics")
    def metrics():
        service = app.state.service
        if service is None:
            raise HTTPException(503, app.state.model_error)
        result = {}
        for split in ("validation", "test"):
            try:
                data = json.loads((ROOT / metrics_dir / split / "model_metrics.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(data, dict) and data.get("model_id") == service.model_id:
                result[split] = data
        if not result:
            raise HTTPException(404, "No saved metrics for the loaded model")
        return result

    @app.post("/predict", response_model=Prediction, response_model_exclude_unset=True)
    async def predict(request: Request):
        content_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
        if content_type not in IMAGE_TYPES:
            raise HTTPException(415, "Send JPEG or PNG bytes with the matching Content-Type")
        service = app.state.service
        if service is None:
            raise HTTPException(503, app.state.model_error)
        content = bytearray()
        try:
            if int(request.headers.get("content-length", "0")) > max_bytes:
                raise HTTPException(413, "Frame exceeds the upload size limit")
        except ValueError as exc:
            raise HTTPException(400, "Invalid Content-Length") from exc
        async for chunk in request.stream():
            if len(content) + len(chunk) > max_bytes:
                raise HTTPException(413, "Frame exceeds the upload size limit")
            content.extend(chunk)
        try:
            image = await run_in_threadpool(decode_image, content, content_type)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return await run_in_threadpool(service.predict, image)

    return app


app = create_app()
