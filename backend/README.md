# Backend

FastAPI loads the trained Random Forest and MediaPipe detector at startup. Install the Python dependencies using the [root setup instructions](../README.md#installation), then run these commands from the project root in PowerShell.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

The interactive API documentation is at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Shows application status and model readiness |
| `GET /models` | Shows loaded model details, supported gestures, and the confidence threshold |
| `GET /metrics` | Returns reports for the loaded model |
| `POST /predict` | Accepts JPEG or PNG bytes with a matching content type and returns a prediction |

The default upload limit is 2 MiB. `/predict` can return `unknown` when a detected hand scores below the default 0.70 threshold, or `no_hand` when the detector finds no hand. Configure the model path, metrics path, threshold, and allowed origins using the [root environment example](../.env.example).

With the reference dataset prepared and the backend running, send a held-out image:

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
