const SEND_INTERVAL_MS = 1000;
const FORCE_INTERVAL_MS = 15000;
let lastPayloadKey = "";
let lastForcedAt = 0;
let lastStartedAt = 0;
let lastMediaId = "";

const browserApi = typeof chrome !== "undefined" ? chrome : browser;

function text(selector) {
  const element = document.querySelector(selector);
  return element ? element.textContent.trim().replace(/\s+/g, " ") : "";
}

function attr(selector, name) {
  const element = document.querySelector(selector);
  return element ? element.getAttribute(name) || "" : "";
}

function absoluteUrl(url) {
  if (!url) return "";
  try {
    return new URL(url, location.origin).toString();
  } catch (_error) {
    return "";
  }
}

function getAudio() {
  const audio = document.querySelector("audio");
  if (audio) return audio;

  const activeMedia = Array.from(document.querySelectorAll("video, audio")).find((element) => {
    return Number.isFinite(element.duration) && element.duration > 0;
  });
  return activeMedia || null;
}

function parseTime(value) {
  const parts = String(value || "")
    .trim()
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function getTimelineTime(selector) {
  return parseTime(
    text(`${selector} span[aria-hidden="true"]`) ||
      text(selector)
  );
}

function getTitle() {
  const title = (
    text(".playbackSoundBadge__titleLink span") ||
    text(".playbackSoundBadge__titleLink") ||
    text(".playbackSoundBadge__title") ||
    attr('meta[property="og:title"]', "content") ||
    document.title.replace(/\s+\|\s+Listen online for free on SoundCloud$/, "").replace(/\s+on SoundCloud$/, "")
  );
  return title.replace(/^Current track:\s*/i, "");
}

function getAuthor() {
  return (
    text(".playbackSoundBadge__lightLink") ||
    text(".playbackSoundBadge__username") ||
    attr('meta[property="music:musician"]', "content") ||
    attr('meta[name="twitter:audio:artist_name"]', "content")
  );
}

function getTrackUrl() {
  return (
    absoluteUrl(attr(".playbackSoundBadge__titleLink", "href")) ||
    attr('meta[property="og:url"]', "content") ||
    location.href
  );
}

function getArtwork() {
  const style = attr(".playbackSoundBadge__avatar span", "style") || attr(".playbackSoundBadge__avatar", "style");
  const match = style.match(/url\(["']?([^"')]+)["']?\)/);
  const artwork = (
    (match ? match[1] : "") ||
    attr(".playbackSoundBadge__avatar img", "src") ||
    attr('meta[property="og:image"]', "content")
  );

  return artwork
    .replace(/-t\d+x\d+\./, "-t500x500.")
    .replace(/-large\./, "-t500x500.");
}

function getTrackId(trackUrl) {
  try {
    const url = new URL(trackUrl);
    return url.pathname.split("/").filter(Boolean).join(":") || url.href;
  } catch (_error) {
    return trackUrl || location.href;
  }
}

function getSoundCloudPayload() {
  const audio = getAudio();
  const title = getTitle();
  const hasBadge = Boolean(document.querySelector(".playbackSoundBadge"));
  if (!title || (!audio && !hasBadge)) return null;

  const uiCurrentTime = getTimelineTime(".playbackTimeline__timePassed");
  const uiDuration = getTimelineTime(".playbackTimeline__duration");
  const duration = audio && Number.isFinite(audio.duration) ? audio.duration : uiDuration;
  const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : uiCurrentTime;
  const url = getTrackUrl();
  const playButton = document.querySelector(".playControls__play");
  const isPlaying = Boolean(
    playButton &&
      (playButton.classList.contains("playing") ||
        playButton.classList.contains("m-playing") ||
        playButton.getAttribute("aria-label") === "Pause current")
  );
  const paused = audio ? audio.paused : !isPlaying;
  const ended = audio ? audio.ended : Boolean(duration && currentTime >= duration);
  const mediaId = getTrackId(url);
  if (mediaId && mediaId !== lastMediaId) {
    lastMediaId = mediaId;
    lastStartedAt = Date.now();
  }

  return {
    platform: "SoundCloud",
    source: "soundcloud",
    action: "Listen",
    url,
    mediaId,
    title,
    author: getAuthor(),
    thumbnail: getArtwork(),
    largeImage: getArtwork(),
    currentTime,
    duration,
    timeLeft: Math.max(duration - currentTime, 0),
    paused,
    ended,
    playbackRate: audio ? audio.playbackRate || 1 : 1,
    lastStartedAt,
    updatedAt: Date.now()
  };
}

function sendUpdate(force = false) {
  const payload = getSoundCloudPayload();
  if (!payload || !payload.title) {
    if (lastPayloadKey) {
      lastPayloadKey = "";
      browserApi.runtime.sendMessage({ type: "media-clear", source: "soundcloud" }, () => {
        void browserApi.runtime.lastError;
      });
    }
    return;
  }

  const payloadKey = JSON.stringify({
    mediaId: payload.mediaId,
    title: payload.title,
    author: payload.author,
    paused: payload.paused,
    ended: payload.ended,
    second: Math.floor(payload.currentTime),
    duration: Math.floor(payload.duration)
  });

  if (!force && payloadKey === lastPayloadKey) return;
  lastPayloadKey = payloadKey;

  browserApi.runtime.sendMessage({ type: "media-update", media: payload }, () => {
    void browserApi.runtime.lastError;
  });
}

function announceSeen() {
  browserApi.runtime.sendMessage(
    {
      type: "media-seen",
      source: "soundcloud",
      platform: "SoundCloud",
      url: location.href,
      hasMediaElement: Boolean(getAudio() || document.querySelector(".playbackSoundBadge")),
      mediaId: getTrackId(getTrackUrl()),
      title: getTitle(),
      updatedAt: Date.now()
    },
    () => {
      void browserApi.runtime.lastError;
    }
  );
}

function bindAudioEvents() {
  const audio = getAudio();
  if (!audio || audio.dataset.discordRpcSoundCloudBound === "true") return;

  audio.dataset.discordRpcSoundCloudBound = "true";
  ["play", "pause", "seeked", "ratechange", "ended", "loadedmetadata", "durationchange"].forEach((eventName) => {
    audio.addEventListener(eventName, () => {
      if (eventName === "play") lastStartedAt = Date.now();
      sendUpdate(true);
    });
  });
}

function bindPlayButton() {
  const playButton = document.querySelector(".playControls__play");
  if (!playButton || playButton.dataset.discordRpcSoundCloudBound === "true") return;

  playButton.dataset.discordRpcSoundCloudBound = "true";
  playButton.addEventListener("click", () => {
    setTimeout(() => {
      const nextPayload = getSoundCloudPayload();
      if (nextPayload && !nextPayload.paused) lastStartedAt = Date.now();
      sendUpdate(true);
    }, 250);
  });
}

setInterval(() => {
  bindAudioEvents();
  bindPlayButton();
  const shouldForce = Date.now() - lastForcedAt > FORCE_INTERVAL_MS;
  if (shouldForce) lastForcedAt = Date.now();
  sendUpdate(shouldForce);
  announceSeen();
}, SEND_INTERVAL_MS);

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastPayloadKey = "";
    setTimeout(() => sendUpdate(true), 700);
  }
  bindAudioEvents();
  bindPlayButton();
}).observe(document.documentElement, { childList: true, subtree: true });

bindAudioEvents();
bindPlayButton();
announceSeen();
sendUpdate(true);
