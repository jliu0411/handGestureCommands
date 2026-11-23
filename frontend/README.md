# Frontend

The React and Vite interface provides Home, Live Recognition, and About pages. Live Recognition captures the webcam, displays predictions and confidence, and turns stable gestures into commands for the card demo.

From the project root in PowerShell, with the [backend running](../backend/README.md):

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite development server proxies `/api` to FastAPI on port 8000. Use [`.env.example`](.env.example) for API URL, frame interval, confidence, stability, and cooldown settings. The preview is mirrored for the user, while frames sent to the detector retain the camera's original orientation.

## Physical webcam checklist

1. Open **Live Recognition**, click **Start recognition**, and grant camera permission. Confirm the video preview starts and a gesture updates the label, confidence, and history.
2. With one hand in good light, use Peace to advance, Point to select, Palm to pause, Thumbs Up to resume, Thumbs Down to cancel, and Fist to stop the demo. Hold each gesture steadily and leave at least 1.5 seconds between commands. A held pose should fire once.
3. Remove your hand to check `no_hand`. An uncertain pose may display `unknown`.
4. Click **Stop recognition** and check that the camera indicator goes off. Start again and navigate away to check release on page exit.
5. Deny camera permission or stop FastAPI during recognition to check the error display.

## Tests and build

```powershell
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
```

Vite writes the production build to `frontend/dist/`.
