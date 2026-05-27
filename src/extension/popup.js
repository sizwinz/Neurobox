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
const callbackForm = document.getElementById("callbackForm");
const callbackUrl = document.getElementById("callbackUrl");
logout.classList.add("secondary");

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function render(state) {
  enabled.checked = state.enabled !== false;
  youtubeEnabled.checked = state.siteEnabled?.youtube !== false;
  soundcloudEnabled.checked = state.siteEnabled?.soundcloud !== false;
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
  } else {
    title.textContent = "No media detected";
    author.textContent = "";
    time.textContent = "";
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

refresh();
setInterval(refresh, 1000);
