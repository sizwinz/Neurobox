const SEND_INTERVAL_MS = 1000;
const FORCE_INTERVAL_MS = 15000;
let lastPayloadKey = "";
let lastForcedAt = 0;
let lastStartedAt = 0;

const browserApi = typeof chrome !== "undefined" ? chrome : browser;

function text(selector) {
  const element = document.querySelector(selector);
  return element ? element.textContent.trim().replace(/\s+/g, " ") : "";
}

function attr(selector, name) {
  const element = document.querySelector(selector);
  return element ? element.getAttribute(name) || "" : "";
}

function getVideoId() {
  const url = new URL(window.location.href);
  if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
  if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/").filter(Boolean)[1] || "";
  if (url.pathname.startsWith("/embed/")) return url.pathname.split("/").filter(Boolean)[1] || "";
  if (url.pathname.startsWith("/live/")) return url.pathname.split("/").filter(Boolean)[1] || "";
  return url.searchParams.get("v") || attr('meta[itemprop="videoId"]', "content");
}

function getAuthor() {
  return (
    text("ytd-watch-metadata ytd-channel-name a") ||
    text("#owner #channel-name a") ||
    text(".slim-owner-byline") ||
    attr('link[itemprop="name"]', "content") ||
    attr('span[itemprop="author"] link[itemprop="name"]', "content")
  );
}

function getTitle() {
  return (
    text("ytd-watch-metadata h1 yt-formatted-string") ||
    text("h1.title") ||
    attr('meta[property="og:title"]', "content") ||
    attr('meta[name="title"]', "content") ||
    document.title.replace(/\s+-\s+YouTube$/, "")
  );
}

function getThumbnail(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

function getVideoPayload() {
  const video = document.querySelector("video");
  const videoId = getVideoId();
  if (!video || !videoId) return null;

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  return {
    platform: "YouTube",
    source: "youtube",
    action: "Watch",
    url: window.location.href,
    videoId,
    mediaId: videoId,
    title: getTitle(),
    author: getAuthor(),
    thumbnail: getThumbnail(videoId),
    currentTime,
    duration,
    timeLeft: Math.max(duration - currentTime, 0),
    paused: video.paused,
    ended: video.ended,
    playbackRate: video.playbackRate || 1,
    lastStartedAt,
    updatedAt: Date.now()
  };
}

function sendUpdate(force = false) {
  const payload = getVideoPayload();
  if (!payload || !payload.title) {
    if (lastPayloadKey) {
      lastPayloadKey = "";
      browserApi.runtime.sendMessage({ type: "youtube-clear" }, () => {
        void browserApi.runtime.lastError;
      });
    }
    return;
  }

  const payloadKey = JSON.stringify({
    videoId: payload.videoId,
    title: payload.title,
    author: payload.author,
    paused: payload.paused,
    ended: payload.ended,
    second: Math.floor(payload.currentTime),
    duration: Math.floor(payload.duration)
  });

  if (!force && payloadKey === lastPayloadKey) return;
  lastPayloadKey = payloadKey;

  browserApi.runtime.sendMessage({ type: "youtube-video", video: payload }, () => {
    void browserApi.runtime.lastError;
  });
}

function announceSeen() {
  browserApi.runtime.sendMessage(
    {
      type: "youtube-seen",
      url: location.href,
      hasVideoElement: Boolean(document.querySelector("video")),
      videoId: getVideoId(),
      title: getTitle(),
      updatedAt: Date.now()
    },
    () => {
      void browserApi.runtime.lastError;
    }
  );
}

function bindVideoEvents() {
  const video = document.querySelector("video");
  if (!video || video.dataset.discordRpcBound === "true") return;

  video.dataset.discordRpcBound = "true";
  ["play", "pause", "seeked", "ratechange", "ended", "loadedmetadata"].forEach((eventName) => {
    video.addEventListener(eventName, () => {
      if (eventName === "play") lastStartedAt = Date.now();
      sendUpdate(true);
    });
  });
}

setInterval(() => {
  bindVideoEvents();
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
  bindVideoEvents();
}).observe(document.documentElement, { childList: true, subtree: true });

bindVideoEvents();
announceSeen();
sendUpdate(true);

["yt-navigate-finish", "yt-page-data-updated", "yt-player-updated"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    lastPayloadKey = "";
    setTimeout(() => {
      bindVideoEvents();
      announceSeen();
      sendUpdate(true);
    }, 250);
  });
});
