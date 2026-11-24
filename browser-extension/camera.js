const allow = document.querySelector('#allow');
const status = document.querySelector('#permission');

allow.addEventListener('click', async () => {
  allow.disabled = true;
  status.textContent = 'Waiting for camera permission…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(track => track.stop());
    status.textContent = 'Camera access granted. Close this tab and start recognition in the side panel.';
  } catch (error) {
    status.textContent = error.name === 'NotAllowedError'
      ? 'Camera access was denied. Check Chrome and Windows camera permissions, then try again.'
      : 'Chrome could not open the camera. Connect a camera or close other apps using it.';
    allow.disabled = false;
  }
});
