# Hand Gesture Controls for Chrome

The Manifest V3 extension controls ordinary HTTP and HTTPS pages that Chrome lets it access. FastAPI runs MediaPipe locally and counts fingers from its landmarks. The original React card demo still uses the saved Random Forest's gesture labels.

## Install and open

1. Start FastAPI from the repository root in PowerShell. See the [project setup](../README.md#installation) if you need a Python environment.

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
   ```

   If port 8000 is occupied by another service or an older backend, use `--port 8765`. The extension checks both ports for a backend with finger-count support.

2. In Chrome 120 or later, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `browser-extension/`. Chrome loads this directory directly. For an existing installation, click **Reload** on the extension card.
3. On the extension card, open **Details** and set **Site access** to **On all sites**. Accept Chrome’s permission prompt if shown. Open an HTTP or HTTPS page, then open **Hand Gesture Controls** from the toolbar. The panel shows the active website and Chrome’s access status. Switching tabs automatically checks the new page.
4. Select **Start recognition** and allow the camera. If Chrome cannot prompt in the side panel, select **Allow camera in a tab** and grant it there, then return to the panel. Use **Pause commands** to suspend interaction or **Stop recognition** to release the webcam.

## Finger-count guide

| Count | Pose | Command |
| --- | --- | --- |
| 0 | Closed fist | Stop scrolling. Recognition stays active. |
| 1 | Index raised | Scroll down while held |
| 2 | Index and middle raised | Scroll up while held |
| 3 | Index, middle, and ring raised | Highlight the next eligible link once |
| 4 | Index through pinky raised, thumb folded | Open the highlighted eligible link once |
| 5 | Open palm with all five digits extended | Go back one webpage once |

Hold your entire hand in view and face your palm toward the camera. The panel displays the count, extended fingers and pose quality. Alternate finger combinations, such as a thumbs-up alone, can have a valid count and still be ineligible for browser commands. Release or change poses to repeat a one-shot command. Use the panel button for pause and resume.

## How recognition works

MediaPipe identifies the wrist, palm knuckles, and finger joints. The deterministic rules compare bend angles and fingertip reach against hand dimensions. The thumb also needs lateral separation from the index knuckle for the five-finger pose. The rules use aspect-corrected coordinates and relative vectors, so they work with both hands and rotations in the image plane. The mirrored preview leaves the captured frame unchanged.

FastAPI reports the count and named finger states only when each digit can be resolved. `reliable` means the geometry resolved all five digits. `uncertain` means a hand was detected but the geometry or multiple hands prevented a clear count. For scrolling and the fist, the rules tolerate a thumb tucked close to the palm. With the ring and pinky folded, a mildly bent index or middle fingertip can count as extended when the finger is straight at the main joint and its tip reaches clearly forward. The extension discards stale predictions and resets pending gesture stability after a sudden palm-center jump. Keep one hand fully visible with the palm facing the camera and raised fingers pointing up.

FastAPI continues to return the Random Forest's label, confidence, and card-demo action separately. The extension reads the finger states and pose quality, so the classifier's `unknown` label does not by itself invalidate a geometrically clear finger pose.

## Timing and permissions

At least two reliable matching detections spanning **180 ms** start one scroll animation in the page. It scrolls at **400 pixels per second** by default, using elapsed time between browser animation frames and carrying fractional pixels forward. Later matching samples renew the current run. A brief mismatched count keeps the current direction while the new pose settles. A confirmed opposite pose switches direction. A closed fist stops scrolling on its first reliable sample.

The defaults in [config.js](config.js) allow 400 ms between matching samples, 350 ms for uncertainty or a missing hand, and 450 ms for an unconfirmed different count. The first mismatch sets a deadline. Further mismatches leave it in place until the original pose returns or a new one is confirmed. If predictions or acknowledged renewals stop arriving, the page stops by the current deadline, at most 600 ms after the last accepted prediction or transition. The panel waits up to 200 ms for each Chrome scroll acknowledgment. Pausing, stopping recognition, closing the panel, switching tabs, or losing Chrome site access cancels the current run. Opening links and Back retain their 700 ms hold and shared 1,000 ms cooldown. Reload the extension after editing the settings.

The side panel sends JPEG frames to the loopback FastAPI server on port 8000 or 8765. The panel checks Chrome’s host permissions and verifies access to the active document before reporting it as accessible. The worker rechecks access before each command. The content script controls scrolling and link selection in the top-level document. Back uses the Chrome Tabs API. Changing tabs stops scrolling on the previous page. Release a pose and hold it again after switching to a new tab.

| Permission | Purpose |
| --- | --- |
| `sidePanel` | Display webcam preview and controls |
| `scripting` | Verify page access and inject controls for a command |
| HTTP/HTTPS host permissions | Control eligible websites and reach FastAPI on loopback. The extension’s network policy limits its own requests to the local backend ports. |

## Troubleshooting

- **Chrome is withholding access** or **Chrome hid the tab URL**. Open the extension’s **Details**, choose **On all sites**, and return to the page. If Chrome prompts for a refresh, refresh the page. A Chrome or administrator restriction can still block access. [Chrome site access controls](https://support.google.com/chrome_webstore/answer/2664769?hl=en)
- **Accessible in Chrome but the page doesn’t move**. Focus that Chrome window, resume commands if paused, and show one hand fully in view. Hold a supported finger combination until the panel reports it as reliable. Try a tall page from a position where there is room to scroll.
- **FastAPI unavailable**. Check that the backend is running from this checkout on `127.0.0.1:8000` or port `8765` and that `/health` reports a ready model. Reload the extension after updating its files.

### Browser Command Diagnostics

With a normal scrollable tab active, open **Browser Command Diagnostics** in the side panel. Use **Test Scroll Down** before **Test Scroll Up**, **Test Highlight Next Link** before **Test Open Selected Link**, then **Test Go Back**. The buttons use the same command dispatcher as finger poses. A scroll test runs for one short interval. Running a test while recognition is active pauses automatic commands until you select **Resume commands**.

Read **Dispatched**, **Worker acknowledged**, **Content acknowledged**, **Executed**, and **Result**. Scrolling is acknowledged after the page actually moves. If only the worker acknowledges, read the reported Chrome error. Switch back to the intended tab and wait for **Accessible in Chrome**. If Chrome reports a missing receiver after an extension reload, refresh the target tab and try once more. If the scroll reaches the content script but reports a boundary, try the opposite direction or a taller page.

Compare **Raw finger count**, **Stable finger count**, and **Pose quality**. A raw count can disagree while the stable pose keeps scrolling. **Gate result** shows why a pose is waiting or was rejected. **Sampling** shows the prediction rate, peak gap between responses, JPEG encoding time, and API latency. Compare those with **Last valid pose**, **Scroll lease**, and **Last scroll renewal** to distinguish recognition gaps from Chrome delivery failures. The Random Forest confidence describes the card-demo prediction. The finger-count gate uses landmark quality. The existing bypass checkbox shortens the stability check for scrolling and highlighting only.

To capture an issue, turn on **Record recent recognition and command transitions**, reproduce it, then select **Copy diagnostic report**. Paste the Markdown report into a GitHub issue. It includes count changes, rejected candidates, command acknowledgments, scroll stops, and sampling changes. Recording is off by default and keeps up to 120 transitions in panel memory. It stores no images, site URLs, or page content and sends no report automatically. Closing the panel or turning recording off clears the log.

## Testing

Run the extension tests from the repository root:

```powershell
node --test browser-extension/tests/*.test.mjs
```

Automated scrolling tests run both directions for at least ten seconds at a simulated 60 Hz display refresh with predictions at 3, 5, 10, and 15 Hz and variable response timing. They check for one animation loop, approximately 400 px/sec, and uninterrupted movement during isolated incorrect, uncertain, and missing-hand samples. They also cover stop behavior, direction changes, and stale scroll messages.

A headless Chrome run replayed selected HaGRID still images through a test camera and the local FastAPI endpoint. The page scrolled down for 13.97 s and up for 13.68 s at 400 px/sec, with a maximum gap of 17.1 ms between scroll events. It continued through brief wrong-count and missing-hand predictions, switched directions, and stopped on a fist. The native side panel and a physical webcam remain part of the manual checklist.

For a manual camera test, run this in a second PowerShell terminal:

```powershell
.\.venv\Scripts\python.exe -m http.server 8789 --bind 127.0.0.1 --directory browser-extension/tests
```

Open `http://127.0.0.1:8789/fixture.html` with **On all sites** enabled, then start recognition. Hold one finger for ten seconds to scroll down, then switch to two fingers for ten seconds to scroll up. Try both hands, slightly different camera angles, and a brief occlusion. Make a fist to stop. Hold three fingers to highlight **Guide**, then four with the thumb folded to open it. Hold five to return and keep the pose briefly to check that Chrome goes back only once. Switch between ordinary websites and confirm the count still changes without restarting recognition. Check a restricted `chrome://` page and try changing Chrome’s Site access to **On click**. Verify the camera indicator goes off when recognition stops.

## Limitations

Finger counting can reject partially occluded fingers, an edge-on hand, or small hands far from the camera. The tracker samples a single visible hand per frame and checks for large center jumps. Keeping other hands out of frame reduces identity changes between samples. Background tab throttling and a slow backend can interrupt continuous scrolling.

The extension uses eligible, visible, same-origin links and preserves the existing safety filters for checkout, forms, downloads, and other sensitive controls. Chrome-internal pages, the Chrome Web Store, embedded frames, and cross-origin links are outside the supported scope.
