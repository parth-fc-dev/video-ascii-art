(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const defaults = {
    preset: "classic",
    characters:
      "$@B%8&WM#QDOHEFRAKPGSNTV*oahkbdpqwmZO0QLCJUYXzcvunxrjft/|()123456789{}[]?-=+~<>i!lI;:,^_`' .",
    resolution: 240,
    frameRate: 60,
    fontSize: 9,
    glowThreshold: 85,
    contrast: 100,
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
    "contrast",
    "sharpness",
    "definition",
    "saturation",
    "textColor",
    "backgroundColor",
    "invert",
  ];
  const toggleButton = document.querySelector("#toggle");
  const toggleLabel = document.querySelector("#toggle-label");
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
      contrast: Number(document.querySelector("#contrast").value),
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

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "ASCII_STATUS") showStatus(message.error, true);
  });

  (async () => {
    const saved = await api.storage.local.get(defaults);
    fillSettings({ ...defaults, ...saved });
    try {
      const state = await sendToTab({ type: "ASCII_STATE" });
      setMode(state.enabled);
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
})();
