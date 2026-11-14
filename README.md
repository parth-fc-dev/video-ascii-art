# YouTube ASCII

A dependency-free Manifest V3 extension that samples the active YouTube video and draws an adjustable ASCII overlay in real time. It uses WebGL2 for GPU rendering when available and falls back to the 2D canvas renderer otherwise. The frame-rate control supports up to 60 fps.

## Files

```text
video-ascii-art/
├── manifest.json
├── gpu-renderer.js
├── content.js
├── popup.html
├── popup.css
├── popup.js
└── README.md
```

## Install in Chrome or Edge

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this project folder, the one containing `manifest.json`.
4. Open or reload a YouTube video page.
5. Select the extension toolbar icon and press **Enable ASCII**.

The popup saves settings locally. Choose a preset or enter a custom character ramp in dark-to-light order. Resolution controls the number of character columns. The status line reports whether WebGL2 GPU or 2D CPU rendering is active. Clicking the page triggers a brief scatter effect.

## Notes

- The extension runs only on `https://www.youtube.com/*` and does not send video or settings off-device.
- Some media streams may prevent canvas pixel reads. If that happens, the extension reports the limitation and restores the normal video.
- WebGL2 is optional. If it is unsupported or fails during rendering, the extension switches to its 2D canvas renderer.
- The manifest targets Chromium browsers (Chrome and Edge); Firefox-specific packaging and compatibility have not been tested.
