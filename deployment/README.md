# Local deployment

Run FastAPI and the Vite development server from the repository root using the [setup instructions](../README.md#installation). Serve the reference model and metrics from `artifacts/`, or set alternate paths using the [backend environment example](../.env.example).

The [frontend build command](../frontend/README.md#tests-and-build) writes static files to `frontend/dist/`. The Vite development proxy applies only to the dev server. In a static deployment, configure a reverse proxy for `/api` or set `VITE_API_URL` before building and permit the site's origin in the API configuration. Webcam access normally requires HTTPS or a loopback origin.

The [Chrome extension](../browser-extension/README.md) loads unpacked and connects to a local FastAPI instance on port 8000 or 8765. Container packaging, hosted deployment, and CI workflows are pending.
