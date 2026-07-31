const browserApi = typeof chrome !== "undefined" ? chrome : browser;

const enabled = document.getElementById("enabled");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const title = document.getElementById("title");
const author = document.getElementById("author");
const time = document.getElementById("time");
const pageStatus = document.getElementById("pageStatus");
const error = document.getElementById("error");
const login = document.getElementById("login");
const logout = document.getElementById("logout");
const clearPresence = document.getElementById("clearPresence");
const youtubeEnabled = document.getElementById("youtubeEnabled");
const soundcloudEnabled = document.getElementById("soundcloudEnabled");
const showUrlEnabled = document.getElementById("showUrlEnabled");
const showYoutubeChannelEnabled = document.getElementById("showYoutubeChannelEnabled");
const callbackForm = document.getElementById("callbackForm");
const callbackUrl = document.getElementById("callbackUrl");

const toggleWhitelist = document.getElementById("toggleWhitelist");
const domainStatus = document.getElementById("domainStatus");
const actionWordingSelect = document.getElementById("actionWordingSelect");
const overrideTitle = document.getElementById("overrideTitle");
const overrideImage = document.getElementById("overrideImage");
const overrideUrl = document.getElementById("overrideUrl");
const overridePlatform = document.getElementById("overridePlatform");
const saveOverride = document.getElementById("saveOverride");
const resetOverride = document.getElementById("resetOverride");

let currentDomain = "";

logout.classList.add("secondary");

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function updateDomainUI(state) {
  if (!currentDomain) return;
  const whitelist = state.rpcWhitelist || ["youtube.com", "soundcloud.com"];
  const isWhitelisted = whitelist.some((d) => currentDomain.endsWith(d));

  if (isWhitelisted) {
    toggleWhitelist.textContent = `Disable RPC on ${currentDomain}`;
    domainStatus.textContent = `RPC Enabled for ${currentDomain}`;
  } else {
    toggleWhitelist.textContent = `Enable RPC on ${currentDomain}`;
    domainStatus.textContent = `RPC Disabled for ${currentDomain}`;
  }

  const override = state.mediaOverrides?.[currentDomain];
  if (override && document.activeElement !== overrideTitle && document.activeElement !== overrideImage && document.activeElement !== overrideUrl && document.activeElement !== overridePlatform) {
    if (!state.lastVideo) {
      overrideTitle.value = override.title || "";
    }
    overrideImage.value = override.image || "";
    overrideUrl.value = override.url || "";
    overridePlatform.value = override.platform || "";
  }
}

function render(state) {
  enabled.checked = state.enabled !== false;
  youtubeEnabled.checked = state.siteEnabled?.youtube !== false;
  soundcloudEnabled.checked = state.siteEnabled?.soundcloud !== false;
  showUrlEnabled.checked = state.showUrl !== false;
  showYoutubeChannelEnabled.checked = state.showYoutubeChannel !== false;
  actionWordingSelect.value = state.actionWording || "Auto";
  dot.classList.toggle("connected", Boolean(state.connected));
  statusText.textContent = state.authenticated
    ? `Connected${state.user?.username ? ` as ${state.user.username}` : ""}`
    : "Discord not connected";
  login.disabled = Boolean(state.authenticated);
  logout.disabled = !state.authenticated;

  const video = state.lastVideo;
  if (video) {
    title.textContent = video.title || "Untitled video";
    author.textContent = video.author ? `by ${video.author}` : "";
    time.textContent = `${formatTime(video.currentTime)} elapsed, ${formatTime(video.timeLeft)} left`;
    if (document.activeElement !== overrideTitle) {
      overrideTitle.value = video.customTitle || video.title || "";
    }
  } else {
    title.textContent = "No media detected";
    author.textContent = "";
    time.textContent = "";
    if (document.activeElement !== overrideTitle && !state.mediaOverrides?.[currentDomain]?.title) {
      overrideTitle.value = "";
    }
  }

  if (!video && state.lastMediaPage) {
    const seen = state.lastMediaPage;
    const platform = seen.platform || "Media";
    const id = seen.mediaId || seen.videoId || "";
    pageStatus.textContent = seen.hasMediaElement || seen.hasVideoElement
      ? `${platform} page seen${id ? `: ${id}` : ""}`
      : `${platform} page seen, waiting for player`;
  } else {
    pageStatus.textContent = "";
  }

  error.textContent = state.lastError || "";
  callbackForm.classList.toggle("visible", Boolean(state.lastError && state.lastError.includes("allizom.org")));

  updateDomainUI(state);
}

function setSiteEnabled(source, checked) {
  browserApi.runtime.sendMessage({ type: "set-site-enabled", source, enabled: checked }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
}

function refresh() {
  browserApi.runtime.sendMessage({ type: "get-state" }, (state) => {
    if (browserApi.runtime.lastError || !state) return;
    render(state);
  });
}

enabled.addEventListener("change", () => {
  browserApi.runtime.sendMessage({ type: "set-enabled", enabled: enabled.checked }, (state) => {
    if (browserApi.runtime.lastError || !state) return;
    render(state);
  });
});

showUrlEnabled.addEventListener("change", () => {
  browserApi.runtime.sendMessage({ type: "set-show-url", showUrl: showUrlEnabled.checked }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

showYoutubeChannelEnabled.addEventListener("change", () => {
  browserApi.runtime.sendMessage({ type: "set-show-youtube-channel", showYoutubeChannel: showYoutubeChannelEnabled.checked }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

actionWordingSelect.addEventListener("change", () => {
  browserApi.runtime.sendMessage({ type: "set-action-wording", wording: actionWordingSelect.value }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

login.addEventListener("click", () => {
  login.disabled = true;
  browserApi.runtime.sendMessage({ type: "login-discord" }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

logout.addEventListener("click", () => {
  browserApi.runtime.sendMessage({ type: "logout-discord" }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

clearPresence.addEventListener("click", () => {
  browserApi.runtime.sendMessage({ type: "clear-presence" }, (state) => {
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

youtubeEnabled.addEventListener("change", () => {
  setSiteEnabled("youtube", youtubeEnabled.checked);
});

soundcloudEnabled.addEventListener("change", () => {
  setSiteEnabled("soundcloud", soundcloudEnabled.checked);
});

toggleWhitelist.addEventListener("click", () => {
  if (!currentDomain) return;
  browserApi.runtime.sendMessage({ type: "toggle-domain-whitelist", domain: currentDomain }, () => {
    refresh();
  });
});

saveOverride.addEventListener("click", () => {
  const newTitle = overrideTitle.value.trim();
  const newImage = overrideImage.value.trim();
  const newUrl = overrideUrl.value.trim();
  const newPlatform = overridePlatform.value.trim();

  let lastVideoMediaKey = "";
  browserApi.runtime.sendMessage({ type: "get-state" }, (currentState) => {
    const video = currentState?.lastVideo;
    if (video && video.mediaKey) {
      lastVideoMediaKey = video.mediaKey;
      browserApi.runtime.sendMessage({
        type: "set-item-override",
        mediaKey: video.mediaKey,
        title: newTitle,
        image: newImage,
        url: newUrl
      });
    }

    if (currentDomain) {
      browserApi.runtime.sendMessage(
        {
          type: "set-domain-override",
          domain: currentDomain,
          title: lastVideoMediaKey ? "" : newTitle,
          image: newImage,
          url: newUrl,
          platform: newPlatform
        },
        () => refresh()
      );
    } else {
      refresh();
    }
  });
});

resetOverride.addEventListener("click", () => {
  const newPlatform = "";
  browserApi.runtime.sendMessage({ type: "get-state" }, (currentState) => {
    const video = currentState?.lastVideo;
    if (video && video.mediaKey) {
      browserApi.runtime.sendMessage({
        type: "set-item-override",
        mediaKey: video.mediaKey,
        title: "",
        image: "",
        url: ""
      });
    }

    if (currentDomain) {
      overrideImage.value = "";
      overrideUrl.value = "";
      overridePlatform.value = "";
      browserApi.runtime.sendMessage(
        { type: "set-domain-override", domain: currentDomain, title: "", image: "", url: "", platform: "" },
        () => refresh()
      );
    } else {
      refresh();
    }
  });
});

callbackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = callbackUrl.value.trim();
  if (!url) return;

  browserApi.runtime.sendMessage({ type: "complete-oauth-callback", url }, (state) => {
    callbackUrl.value = "";
    if (browserApi.runtime.lastError || !state) return refresh();
    render(state);
  });
});

browserApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0] && tabs[0].url) {
    try {
      const url = new URL(tabs[0].url);
      currentDomain = url.hostname.replace(/^www\./, "");
    } catch (_e) {}
  }
  refresh();
});

setInterval(refresh, 1000);

