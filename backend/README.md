# Backend

FastAPI loads the trained Random Forest and MediaPipe detector at startup. Install the Python dependencies using the [root setup instructions](../README.md#installation), then run these commands from the project root in PowerShell.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Check that the service reports `model_ready: true` before opening the React dashboard or Chrome extension. [Health endpoint](http://127.0.0.1:8000/health) · [Interactive API documentation](http://127.0.0.1:8000/docs)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Shows application status and model readiness |
| `GET /models` | Shows loaded model details, supported gestures, and the confidence threshold |
| `GET /metrics` | Returns reports for the loaded model |
| `POST /predict` | Accepts JPEG or PNG bytes with a matching content type and returns a prediction |

The default upload limit is 2 MiB. The Random Forest can return `unknown` when a detected hand scores below the default 0.70 threshold, or `no_hand` when the detector finds no hand. When available, `hand_center` supplies normalized image coordinates `x` and `y`, with Y increasing toward the bottom of the frame. Configure model paths, the classifier threshold, and allowed origins in the [root environment example](../.env.example).

Finger counting is a separate landmark-based result. `finger_count` is an integer from 0 to 5. `finger_states` contains booleans for `thumb`, `index`, `middle`, `ring`, and `pinky`. `finger_count_quality` is `"reliable"` for a count resolved by the joint-angle and relative-distance rules. Ambiguous geometry or multiple detected hands return `"uncertain"` with a null count and null states. Without a detected hand, all three fields are null. The `gesture`, `confidence`, and `action` fields describe the Random Forest result. Clients can check `/models` for `capabilities.finger_count`.

With the reference dataset prepared and the backend running, use the following commands to send a held-out image. [Dataset setup](../datasets/README.md)

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
$sample = Import-Csv datasets/processed/landmarks.csv |
    Where-Object { $_.split -eq 'test' -and $_.label -eq 'peace' } |
    Select-Object -First 1
$image = Join-Path (Get-Location).Path "datasets/raw/hagrid-export_100_images/$($sample.path)"
Invoke-RestMethod http://127.0.0.1:8000/predict -Method Post -ContentType image/jpeg -InFile $image
```

Run the backend tests from the project root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend/tests
```
