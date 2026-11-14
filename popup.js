(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const defaults = {
    preset: "classic",
    characters:
      "$@B%8&WM#QDOHEFRAKPGSNTV*oahkbdpqwmZO0QLCJUYXzcvunxrjft/|()123456789{}[]?-=+~<>i!lI;:,^_`' .",
    resolution: 300,
    frameRate: 60,
    fontSize: 9,
    glowThreshold: 85,
    glowAmount: 100,
    glowSize: 45,
    contrast: 100,
    blackLevel: 0,
    whiteLevel: 100,
    sharpness: 25,
    definition: 20,
    saturation: 100,
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
  const fields = [
    "preset",
    "characters",
    "resolution",
    "frameRate",
    "fontSize",
    "glowThreshold",
    "glowAmount",
    "glowSize",
    "contrast",
    "blackLevel",
    "whiteLevel",
    "sharpness",
    "definition",
    "saturation",
    "textColor",
    "backgroundColor",
    "invert",
  ];
  const toggleButton = document.querySelector("#toggle");
  const toggleLabel = document.querySelector("#toggle-label");
  const exportButton = document.querySelector("#export-frame");
  const timeline = document.querySelector("#timeline");
  const frameTime = document.querySelector("#frame-time");
  const frameBack = document.querySelector("#frame-back");
  const frameForward = document.querySelector("#frame-forward");
  const status = document.querySelector("#status");
  const characterInput = document.querySelector("#characters");
  let activeTabId = null;
  let saveTimer = 0;

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function setMode(enabled) {
    toggleButton.setAttribute("aria-pressed", String(enabled));
    toggleLabel.textContent = enabled ? "Disable ASCII" : "Enable ASCII";
  }

  function displayValue(id, value) {
    const output = document.querySelector(`#${id}-value`);
    if (output) {
      const suffix =
        id === "frameRate"
          ? " fps"
          : id === "fontSize"
            ? " px"
            : id === "resolution"
              ? " cols"
              : "%";
      output.value = `${value}${suffix}`;
    }
  }

  function readSettings() {
    return {
      preset: document.querySelector("#preset").value,
      characters: characterInput.value,
      resolution: Number(document.querySelector("#resolution").value),
      frameRate: Number(document.querySelector("#frameRate").value),
      fontSize: Number(document.querySelector("#fontSize").value),
      glowThreshold: Number(document.querySelector("#glowThreshold").value),
      glowAmount: Number(document.querySelector("#glowAmount").value),
      glowSize: Number(document.querySelector("#glowSize").value),
      contrast: Number(document.querySelector("#contrast").value),
      blackLevel: Number(document.querySelector("#blackLevel").value),
      whiteLevel: Number(document.querySelector("#whiteLevel").value),
      sharpness: Number(document.querySelector("#sharpness").value),
      definition: Number(document.querySelector("#definition").value),
      saturation: Number(document.querySelector("#saturation").value),
      textColor: document.querySelector("#textColor").value,
      backgroundColor: document.querySelector("#backgroundColor").value,
      invert: document.querySelector("#invert").checked,
    };
  }

  function fillSettings(settings) {
    if (settings.preset !== "custom") {
      settings.characters =
        presetCharacters[settings.preset] ?? settings.characters;
    }
    for (const id of fields) {
      const input = document.querySelector(`#${id}`);
      if (id === "invert") input.checked = Boolean(settings[id]);
      else input.value = settings[id];
      displayValue(id, settings[id]);
    }
    characterInput.disabled = settings.preset !== "custom";
  }

  async function getActiveTab() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://www.youtube.com/")) {
      throw new Error("Open a YouTube video page to use ASCII mode.");
    }
    return tab;
  }

  async function sendToTab(message) {
    const tab = await getActiveTab();
    activeTabId = tab.id;
    return api.tabs.sendMessage(tab.id, message);
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remaining = String(safeSeconds % 60).padStart(2, "0");
    return `${minutes}:${remaining}`;
  }

  function updateNavigator(state) {
    const duration = Number(state.duration) || 0;
    const currentTime = Number(state.currentTime) || 0;
    const hasDuration = duration > 0 && Number.isFinite(duration);
    timeline.disabled = !hasDuration;
    frameBack.disabled = !hasDuration;
    frameForward.disabled = !hasDuration;
    if (document.activeElement !== timeline) {
      timeline.value = hasDuration
        ? String(Math.round((currentTime / duration) * 1000))
        : "0";
    }
    frameTime.value = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  }

  async function saveSettings() {
    const settings = readSettings();
    await api.storage.local.set(settings);
    try {
      await sendToTab({ type: "ASCII_SETTINGS", settings });
    } catch {
      // Settings are persisted and will apply when the content script is available.
    }
    showStatus("Settings saved.");
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(
      () =>
        saveSettings().catch(() =>
          showStatus("Could not save settings.", true),
        ),
      120,
    );
  }

  document.querySelector("#preset").addEventListener("change", (event) => {
    const preset = event.currentTarget.value;
    if (preset !== "custom") characterInput.value = presetCharacters[preset];
    characterInput.disabled = preset !== "custom";
    scheduleSave();
  });

  characterInput.addEventListener("input", () => {
    document.querySelector("#preset").value = "custom";
    characterInput.disabled = false;
    scheduleSave();
  });

  for (const id of fields.filter(
    (field) => field !== "preset" && field !== "characters",
  )) {
    const input = document.querySelector(`#${id}`);
    input.addEventListener("input", () => {
      displayValue(id, id === "invert" ? input.checked : input.value);
      scheduleSave();
    });
    input.addEventListener("change", scheduleSave);
  }

  toggleButton.addEventListener("click", async () => {
    toggleButton.disabled = true;
    try {
      const state = await sendToTab({ type: "ASCII_TOGGLE" });
      setMode(state.enabled);
      showStatus(
        state.error ||
          (state.enabled
            ? `ASCII overlay is running (${state.renderer}).`
            : "Normal video is restored."),
        Boolean(state.error),
      );
    } catch (error) {
      showStatus(
        error.message?.includes("Receiving end")
          ? "Reload this YouTube tab, then try again."
          : error.message || "Could not reach this tab.",
        true,
      );
    } finally {
      toggleButton.disabled = false;
    }
  });

  async function navigateFrame(message) {
    try {
      const state = await sendToTab(message);
      if (state.error) throw new Error(state.error);
      updateNavigator(state);
      if (message.type === "ASCII_STEP_FRAME")
        showStatus("Video paused at selected frame.");
    } catch (error) {
      showStatus(error.message || "Could not navigate the video.", true);
    }
  }

  frameBack.addEventListener("click", () => {
    navigateFrame({ type: "ASCII_STEP_FRAME", direction: -1 });
  });
  frameForward.addEventListener("click", () => {
    navigateFrame({ type: "ASCII_STEP_FRAME", direction: 1 });
  });
  timeline.addEventListener("input", () => {
    const ratio = Number(timeline.value) / 1000;
    const duration = Number(timeline.dataset.duration) || 0;
    if (duration > 0) {
      navigateFrame({ type: "ASCII_SEEK", time: ratio * duration });
    }
  });

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    showStatus("Rendering 4K PNG from the current frame...");
    try {
      const settings = readSettings();
      await api.storage.local.set(settings);
      const tab = await getActiveTab();
      await api.tabs.sendMessage(tab.id, { type: "ASCII_SETTINGS", settings });
      const result = await api.tabs.sendMessage(tab.id, {
        type: "ASCII_EXPORT_FRAME",
      });
      if (result?.error) throw new Error(result.error);
      if (!result?.dataUrl?.startsWith("data:image/png;base64,")) {
        throw new Error("The frame export did not return a PNG image.");
      }
      const downloadId = await api.downloads.download({
        url: result.dataUrl,
        filename: "youtube-ascii-4k.png",
        saveAs: true,
        conflictAction: "uniquify",
      });
      showStatus(`Save dialog opened for 4K PNG (download ${downloadId}).`);
    } catch (error) {
      showStatus(error.message || "Could not export this frame.", true);
    } finally {
      exportButton.disabled = false;
    }
  });

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "ASCII_STATUS") showStatus(message.error, true);
  });

  (async () => {
    const saved = await api.storage.local.get(defaults);
    fillSettings({ ...defaults, ...saved });
    try {
      const state = await sendToTab({ type: "ASCII_STATE" });
      setMode(state.enabled);
      exportButton.disabled = false;
      timeline.dataset.duration = String(state.duration || 0);
      updateNavigator(state);
      if (state.error) showStatus(state.error, true);
      else
        showStatus(
          state.enabled
            ? `ASCII overlay is running (${state.renderer}).`
            : "Ready on this YouTube tab.",
        );
    } catch {
      toggleButton.disabled = true;
      showStatus("Open or reload a YouTube video page to begin.");
    }
  })().catch(() => showStatus("Could not load saved settings.", true));

  window.setInterval(async () => {
    try {
      const state = await sendToTab({ type: "ASCII_STATE" });
      timeline.dataset.duration = String(state.duration || 0);
      updateNavigator(state);
    } catch {
      timeline.disabled = true;
      frameBack.disabled = true;
      frameForward.disabled = true;
    }
  }, 400);
})();
