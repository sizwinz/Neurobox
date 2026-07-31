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

function getMainVideoElement() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) return null;
  const active = videos.find((v) => !v.paused && !v.ended && Number.isFinite(v.duration) && v.duration > 0);
  if (active) return active;
  const valid = videos.filter((v) => Number.isFinite(v.duration) && v.duration > 0);
  return valid[0] || videos[0] || null;
}

function getAuthor() {
  return (
    text("ytd-watch-metadata #owner #channel-name a") ||
    text("ytd-watch-metadata ytd-channel-name a") ||
    text("#owner #channel-name a") ||
    text("#owner #channel-name yt-formatted-string") ||
    text("#owner #channel-name yt-attributed-string") ||
    text("ytd-reel-player-header-renderer #channel-name a") ||
    text(".slim-owner-byline") ||
    text(".ytp-title-channel-name") ||
    attr('link[itemprop="name"]', "content") ||
    attr('span[itemprop="author"] link[itemprop="name"]', "content")
  );
}

function getTitle() {
  const title = (
    text("ytd-watch-metadata #title yt-formatted-string") ||
    text("ytd-watch-metadata #title yt-attributed-string") ||
    text("ytd-watch-metadata h1 yt-formatted-string") ||
    text("ytd-watch-metadata h1") ||
    text("h1.ytd-watch-metadata") ||
    text("h1.title") ||
    text("#title h1 yt-formatted-string") ||
    text("ytd-reel-player-header-renderer .title") ||
    text("h1.ytd-video-primary-info-renderer") ||
    text(".ytp-title-link") ||
    attr('meta[property="og:title"]', "content") ||
    attr('meta[name="title"]', "content")
  );

  if (title && title.toLowerCase() !== "youtube") return title;

  return document.title
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s+-\s+YouTube$/i, "")
    .replace(/\s+-\s+YouTube Music$/i, "")
    .trim();
}

function getThumbnail(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

function getChannelAvatar() {
  const selectors = [
    "ytd-watch-metadata #owner img#img",
    "ytd-watch-metadata #owner #avatar img",
    "ytd-watch-metadata #owner img",
    "ytd-video-owner-renderer #avatar img",
    "ytd-video-owner-renderer img",
    "#owner #avatar img",
    "ytd-reel-player-header-renderer img",
    ".ytp-title-channel-logo img"
  ];
  for (const s of selectors) {
    const img = document.querySelector(s);
    if (img) {
      const src = img.src || img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (src && !src.startsWith("data:")) {
        return src.startsWith("//") ? `https:${src}` : src;
      }
    }
  }
  return "";
}

function getCategoryInfo() {
  const url = window.location.href;
  if (url.includes("music.youtube.com")) {
    return { platform: "YouTube Music", action: "Listen" };
  }
  if (url.includes("/shorts/")) {
    return { platform: "YouTube Short", action: "Watch" };
  }
  return { platform: "YouTube", action: "Watch" };
}

function getVideoPayload() {
  const video = getMainVideoElement();
  const videoId = getVideoId();
  if (!video || !videoId) return null;

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const category = getCategoryInfo();

  return {
    platform: category.platform,
    source: "youtube",
    action: category.action,
    url: window.location.href,
    videoId,
    mediaId: videoId,
    title: getTitle(),
    author: getAuthor(),
    channelAvatar: getChannelAvatar(),
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

let lastUrl = location.href;
let lastVideoId = "";

function bindVideoEvents() {
  const video = document.querySelector("video");
  const currentVideoId = getVideoId();
  if (!video) return;

  if (video.dataset.discordRpcBoundId !== currentVideoId) {
    video.dataset.discordRpcBoundId = currentVideoId;
    ["play", "pause", "seeked", "ratechange", "ended", "loadedmetadata"].forEach((eventName) => {
      video.addEventListener(eventName, () => {
        if (eventName === "play") lastStartedAt = Date.now();
        sendUpdate(true);
      });
    });
  }
}

function handleNavigation() {
  const currentVideoId = getVideoId();
  if (location.href !== lastUrl || (currentVideoId && currentVideoId !== lastVideoId)) {
    lastUrl = location.href;
    lastVideoId = currentVideoId;
    lastPayloadKey = "";
    lastStartedAt = Date.now();

    [100, 400, 1000, 2000, 3500].forEach((delay) => {
      setTimeout(() => {
        bindVideoEvents();
        announceSeen();
        sendUpdate(true);
      }, delay);
    });
  }
}

setInterval(() => {
  handleNavigation();
  bindVideoEvents();
  const shouldForce = Date.now() - lastForcedAt > FORCE_INTERVAL_MS;
  if (shouldForce) lastForcedAt = Date.now();
  sendUpdate(shouldForce);
  announceSeen();
}, SEND_INTERVAL_MS);

new MutationObserver(() => {
  handleNavigation();
  bindVideoEvents();
}).observe(document.documentElement, { childList: true, subtree: true });

bindVideoEvents();
announceSeen();
sendUpdate(true);

["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated", "yt-player-updated", "spfdone"].forEach((eventName) => {
  window.addEventListener(eventName, handleNavigation);
  document.addEventListener(eventName, handleNavigation);
});
