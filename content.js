(() => {
  if (window.top !== window) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const defaults = {
    preset: "classic",
    characters:
      "$@B%8&WM#QDOHEFRAKPGSNTV*oahkbdpqwmZO0QLCJUYXzcvunxrjft/|()123456789{}[]?-=+~<>i!lI;:,^_`' .",
    resolution: 570,
    frameRate: 60,
    fontSize: 12,
    glowThreshold: 81,
    contrast: 95,
    sharpness: 45,
    definition: 45,
    saturation: 170,
    textColor: "#f4f4f0",
    backgroundColor: "#111111",
    invert: false,
  };
  const presetCharacters = {
    classic:
      "$@B%8&WM#QDOHEFRAKPGSNTV*oahkbdpqwmZO0QLCJUYXzcvunxrjft/|()123456789{}[]?-=+~<>i!lI;:,^_`' .",
    colored:
      "$@B%8&WM#QDOHEFRAKPGSNTV*oahkbdpqwmZO0QLCJUYXzcvunxrjft/|()123456789{}[]?-=+~<>i!lI;:,^_`' .",
    minimal: " .",
  };

  let settings = { ...defaults };
  let video = null;
  let overlay = null;
  let outputContext = null;
  let gpuRenderer = null;
  let gpuContextLost = false;
  let sampleCanvas = null;
  let sampleContext = null;
  let luminanceBuffer = new Float32Array(0);
  let adjustedColorBuffer = new Uint8ClampedArray(0);
  let previousPixels = new Uint8ClampedArray(0);
  let renderedCells = [];
  let renderLayoutKey = "";
  let renderCacheValid = false;
  let scatterWasActive = false;
  let enabled = false;
  let animationId = 0;
  let lastFrameAt = 0;
  let scatterUntil = 0;
  let originalOpacity = "";
  let lastError = "";

  function chooseVideo() {
    return (
      [...document.querySelectorAll("video")]
        .filter((candidate) => {
          const bounds = candidate.getBoundingClientRect();
          return bounds.width > 80 && bounds.height > 60;
        })
        .sort((left, right) => {
          const a = left.getBoundingClientRect();
          const b = right.getBoundingClientRect();
          return b.width * b.height - a.width * a.height;
        })[0] ?? null
    );
  }

  function createOverlay() {
    overlay = document.createElement("canvas");
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      display: "block",
    });
    document.documentElement.appendChild(overlay);
    try {
      gpuRenderer = globalThis.YouTubeAsciiGpu?.create(overlay) ?? null;
      if (gpuRenderer) {
        gpuContextLost = false;
        overlay.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          gpuContextLost = true;
        });
      }
    } catch {
      overlay.remove();
      overlay = document.createElement("canvas");
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "fixed",
        zIndex: "2147483646",
        pointerEvents: "none",
        display: "block",
      });
      document.documentElement.appendChild(overlay);
      gpuRenderer = null;
    }
    if (!gpuRenderer)
      outputContext = overlay.getContext("2d", { alpha: false });
    sampleCanvas = document.createElement("canvas");
    sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  }

  function attachToVideo(nextVideo) {
    if (video === nextVideo) return;
    detachFromVideo();
    if (!nextVideo) return;
    video = nextVideo;
    originalOpacity = video.style.opacity;
    video.style.opacity = "0";
    createOverlay();
    lastError = "";
  }

  function detachFromVideo() {
    if (video) video.style.opacity = originalOpacity;
    video = null;
    gpuRenderer?.dispose();
    gpuRenderer = null;
    gpuContextLost = false;
    overlay?.remove();
    overlay = null;
    outputContext = null;
    sampleCanvas = null;
    sampleContext = null;
    renderedCells = [];
    previousPixels = new Uint8ClampedArray(0);
    renderLayoutKey = "";
    renderCacheValid = false;
  }

  function fallbackTo2D() {
    try {
      gpuRenderer?.dispose();
    } catch {
      // The WebGL context may already be lost.
    }
    gpuRenderer = null;
    gpuContextLost = false;
    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.setAttribute("aria-hidden", "true");
    fallbackCanvas.style.cssText = overlay.style.cssText;
    overlay.replaceWith(fallbackCanvas);
    overlay = fallbackCanvas;
    outputContext = overlay.getContext("2d", { alpha: false });
    renderCacheValid = false;
    renderLayoutKey = "";
    return Boolean(outputContext);
  }

  function resizeOverlay(bounds, pixelRatio) {
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    const resized = overlay.width !== width || overlay.height !== height;
    if (resized) {
      overlay.width = width;
      overlay.height = height;
    }
    Object.assign(overlay.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
    if (outputContext)
      outputContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return resized;
  }

  function renderFrame(now) {
    animationId = 0;
    if (!enabled) return;
    animationId = requestAnimationFrame(renderFrame);

    const currentVideo = chooseVideo();
    if (currentVideo !== video) attachToVideo(currentVideo);
    if (
      !video ||
      !overlay ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      return;

    const frameInterval =
      1000 / Math.max(10, Math.min(60, Number(settings.frameRate) || 60));
    if (now - lastFrameAt < frameInterval) return;
    lastFrameAt = now;

    const bounds = video.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    try {
      const requestedColumns = Math.max(
        20,
        Math.min(600, Number(settings.resolution) || 240),
      );
      const fontSize = Math.max(
        6,
        Math.min(48, Number(settings.fontSize) || 9),
      );
      const columns = Math.min(
        600,
        Math.max(
          20,
          Math.min(
            requestedColumns,
            Math.ceil(bounds.width / (fontSize * 0.62)),
          ),
        ),
      );
      const cellWidth = bounds.width / columns;
      const cellHeight = fontSize * 1;
      const rows = Math.max(1, Math.ceil(bounds.height / cellHeight));
      const pixelRatio = window.devicePixelRatio || 1;
      if (gpuRenderer && gpuContextLost && !fallbackTo2D()) {
        throw new Error("GPU and 2D canvas rendering are unavailable.");
      }
      if (gpuRenderer) {
        const characters =
          settings.preset === "custom"
            ? settings.characters
            : (presetCharacters[settings.preset] ?? defaults.characters);
        resizeOverlay(bounds, pixelRatio);
        try {
          gpuRenderer.render(video, {
            width: bounds.width,
            height: bounds.height,
            columns,
            rows,
            characters,
            settings,
            glowThreshold:
              Math.max(
                50,
                Math.min(100, Number(settings.glowThreshold) || 85),
              ) / 100,
            scattering: now < scatterUntil,
            scatterStrength:
              now < scatterUntil ? (scatterUntil - now) / 550 : 0,
            now,
          });
          lastError = "";
          return;
        } catch {
          if (!fallbackTo2D())
            throw new Error("GPU and 2D canvas rendering are unavailable.");
        }
      }
      const layoutKey = [
        columns,
        rows,
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height,
        pixelRatio,
        fontSize,
        settings.backgroundColor,
      ].join(":");
      const layoutChanged = layoutKey !== renderLayoutKey;
      if (layoutChanged) renderCacheValid = false;
      if (sampleCanvas.width !== columns || sampleCanvas.height !== rows) {
        sampleCanvas.width = columns;
        sampleCanvas.height = rows;
      }
      sampleContext.drawImage(video, 0, 0, columns, rows);
      const pixels = sampleContext.getImageData(0, 0, columns, rows).data;
      const pixelCount = columns * rows;
      const byteCount = pixelCount * 4;
      if (previousPixels.length !== byteCount) {
        previousPixels = new Uint8ClampedArray(byteCount);
        renderedCells = new Array(pixelCount);
        renderCacheValid = false;
      } else if (renderCacheValid) {
        let frameChanged = false;
        for (let index = 0; index < byteCount; index += 1) {
          if (pixels[index] !== previousPixels[index]) {
            frameChanged = true;
            break;
          }
        }
        if (!frameChanged) return;
      }
      if (luminanceBuffer.length !== pixelCount) {
        luminanceBuffer = new Float32Array(pixelCount);
        adjustedColorBuffer = new Uint8ClampedArray(pixelCount * 3);
      }
      const luminance = luminanceBuffer;
      const adjustedColors = adjustedColorBuffer;
      const contrast =
        Math.max(0, Math.min(200, Number(settings.contrast) || 0)) / 100;
      const saturation =
        Math.max(0, Math.min(200, Number(settings.saturation) || 0)) / 100;
      const sharpness =
        Math.max(0, Math.min(100, Number(settings.sharpness) || 0)) / 100;
      const definition =
        Math.max(0, Math.min(100, Number(settings.definition) || 0)) / 100;
      const contrastOffset = 127.5 * (1 - contrast);
      for (let index = 0; index < pixelCount; index += 1) {
        const source = index * 4;
        const target = index * 3;
        const red = pixels[source];
        const green = pixels[source + 1];
        const blue = pixels[source + 2];
        const gray = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const adjustedRed =
          (gray + (red - gray) * saturation) * contrast + contrastOffset;
        const adjustedGreen =
          (gray + (green - gray) * saturation) * contrast + contrastOffset;
        const adjustedBlue =
          (gray + (blue - gray) * saturation) * contrast + contrastOffset;
        adjustedColors[target] = adjustedRed;
        adjustedColors[target + 1] = adjustedGreen;
        adjustedColors[target + 2] = adjustedBlue;
        luminance[index] =
          (0.2126 * adjustedRed +
            0.7152 * adjustedGreen +
            0.0722 * adjustedBlue) /
          255;
      }
      const characters =
        settings.preset === "custom"
          ? settings.characters
          : (presetCharacters[settings.preset] ?? defaults.characters);
      const usableCharacters = [...(characters || defaults.characters)];

      const resized = resizeOverlay(bounds, pixelRatio);
      if (resized || layoutChanged) {
        outputContext.fillStyle = settings.backgroundColor;
        outputContext.fillRect(0, 0, bounds.width, bounds.height);
        renderedCells = new Array(pixelCount);
        renderLayoutKey = layoutKey;
        renderCacheValid = false;
      }
      outputContext.font = `${fontSize}px monospace`;
      outputContext.textBaseline = "top";

      const scattering = now < scatterUntil;
      const scatterStrength = scattering ? (scatterUntil - now) / 550 : 0;
      if (scatterWasActive && !scattering) renderCacheValid = false;
      scatterWasActive = scattering;
      const colored = settings.preset === "colored";
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const pixelIndex = row * columns + column;
          const colorIndex = pixelIndex * 3;
          const center = luminance[pixelIndex];
          const left = luminance[row * columns + Math.max(0, column - 1)];
          const right =
            luminance[row * columns + Math.min(columns - 1, column + 1)];
          const above = luminance[Math.max(0, row - 1) * columns + column];
          const below =
            luminance[Math.min(rows - 1, row + 1) * columns + column];
          const edge = center - (left + right + above + below) * 0.25;
          let brightness = Math.max(
            0,
            Math.min(1, center + edge * (sharpness + definition * 0.35)),
          );
          if (settings.invert) brightness = 1 - brightness;
          const threshold =
            Math.max(50, Math.min(98, Number(settings.glowThreshold) || 85)) /
            100;
          const glowAmount = Math.max(
            0,
            Math.min(1, (center - threshold) / (1 - threshold)),
          );
          const mappedCharacterIndex = Math.min(
            usableCharacters.length - 1,
            Math.floor(brightness * usableCharacters.length),
          );
          const characterIndex =
            glowAmount > 0.05
              ? Math.min(
                  mappedCharacterIndex,
                  Math.floor(
                    (1 - glowAmount * 0.7) * (usableCharacters.length - 1),
                  ),
                )
              : mappedCharacterIndex;
          const character = usableCharacters[characterIndex];
          const baseColor = colored
            ? `rgb(${adjustedColors[colorIndex]}, ${adjustedColors[colorIndex + 1]}, ${adjustedColors[colorIndex + 2]})`
            : settings.textColor;
          const color =
            glowAmount > 0.05
              ? colored
                ? "#ffffff"
                : settings.textColor
              : baseColor;
          const cellKey = `${character ?? " "}\0${color}`;
          if (!scattering && renderedCells[pixelIndex] === cellKey) continue;

          const x = column * cellWidth;
          const y = row * cellHeight;
          outputContext.fillStyle = settings.backgroundColor;
          outputContext.fillRect(x, y, cellWidth + 1, cellHeight + 1);
          const scatterX = scattering
            ? (Math.random() - 0.5) * 16 * scatterStrength
            : 0;
          const scatterY = scattering
            ? (Math.random() - 0.5) * 12 * scatterStrength
            : 0;
          if (character && character !== " ") {
            if (glowAmount > 0.05) {
              outputContext.shadowColor = color;
              outputContext.shadowBlur = glowAmount * fontSize * 1.5;
            }
            outputContext.fillStyle = color;
            outputContext.fillText(
              character,
              x + scatterX,
              y + scatterY,
              cellWidth,
            );
            outputContext.shadowBlur = 0;
            outputContext.shadowColor = "transparent";
          }
          renderedCells[pixelIndex] = scattering ? null : cellKey;
        }
      }
      previousPixels.set(pixels);
      renderCacheValid = !scattering;
      lastError = "";
    } catch (error) {
      lastError =
        error?.name === "SecurityError"
          ? "The video stream blocks canvas capture, so ASCII rendering is unavailable for this playback."
          : `Rendering failed: ${error?.message ?? "unknown error"}`;
      api.runtime
        .sendMessage({ type: "ASCII_STATUS", error: lastError })
        .catch(() => {});
      stopAscii();
    }
  }

  function startAscii() {
    enabled = true;
    attachToVideo(chooseVideo());
    if (!animationId) animationId = requestAnimationFrame(renderFrame);
  }

  function stopAscii() {
    enabled = false;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
    detachFromVideo();
  }

  function currentState() {
    return {
      enabled,
      error: lastError,
      renderer: gpuRenderer ? "WebGL2 GPU" : "2D CPU",
    };
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ASCII_TOGGLE") {
      if (enabled) stopAscii();
      else startAscii();
      sendResponse(currentState());
    } else if (message?.type === "ASCII_SETTINGS") {
      settings = { ...defaults, ...message.settings };
      renderCacheValid = false;
      sendResponse(currentState());
    } else if (message?.type === "ASCII_STATE") {
      sendResponse(currentState());
    }
    return false;
  });

  api.storage.local.get(defaults).then((saved) => {
    settings = { ...defaults, ...saved };
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in defaults) settings[key] = change.newValue ?? defaults[key];
    }
    renderCacheValid = false;
  });

  document.addEventListener(
    "click",
    () => {
      if (enabled) scatterUntil = performance.now() + 550;
      if (enabled && !video) attachToVideo(chooseVideo());
    },
    true,
  );

  const observer = new MutationObserver(() => {
    if (enabled && !video) attachToVideo(chooseVideo());
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("yt-navigate-finish", () => {
    if (enabled) attachToVideo(chooseVideo());
  });
})();
