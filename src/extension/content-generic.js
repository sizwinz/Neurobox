(function () {
  const browserApi = typeof chrome !== "undefined" ? chrome : browser;
  const SEND_INTERVAL_MS = 1000;
  const FORCE_INTERVAL_MS = 15000;
  let lastPayloadKey = "";
  let lastForcedAt = 0;
  let lastStartedAt = 0;
  let isWhitelisted = false;

  function cleanTitle(rawTitle) {
    if (!rawTitle) return "";
    return rawTitle
      .replace(/\s*[\-\|]\s*(Watch|Free|Online|HD|1080p|Full Movie|Streaming).*$/i, "")
      .replace(/\s*\((Watch|Free|Online|HD|1080p)\)/gi, "")
      .trim();
  }

  function getMediaTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const rawTitle = ogTitle || document.title || "Video";
    return cleanTitle(rawTitle);
  }

  function toAbsoluteUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, window.location.origin).href;
    } catch (_) {
      return "";
    }
  }

  function getMediaPoster() {
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const twitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    const raw = ogImage || twitterImage || "/favicon.ico";
    return toAbsoluteUrl(raw);
  }

  function getActiveMediaElement() {
    const elements = Array.from(document.querySelectorAll("video, audio"));
    return elements.find((el) => !el.paused && Number.isFinite(el.duration) && el.duration > 0) || elements[0] || null;
  }

  function getEffectiveDomain() {
    let host = window.location.hostname;
    if (window.self !== window.top && document.referrer) {
      try {
        const refUrl = new URL(document.referrer);
        if (refUrl.hostname) host = refUrl.hostname;
      } catch (_) {}
    }
    return host.replace(/^www\./, "");
  }

  function getEffectiveUrl() {
    if (window.self !== window.top && document.referrer) {
      return document.referrer;
    }
    return window.location.href;
  }

  function getPayload() {
    const media = getActiveMediaElement();
    if (!media) return null;

    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    const currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    const domain = getEffectiveDomain();

    return {
      platform: domain,
      source: "generic",
      domain: domain,
      action: media.tagName === "AUDIO" ? "Listen" : "Watch",
      url: getEffectiveUrl(),
      mediaId: window.location.pathname,
      title: getMediaTitle(),
      author: domain,
      thumbnail: getMediaPoster(),
      largeImage: getMediaPoster(),
      currentTime,
      duration,
      timeLeft: Math.max(duration - currentTime, 0),
      paused: media.paused,
      ended: media.ended,
      playbackRate: media.playbackRate || 1,
      lastStartedAt,
      updatedAt: Date.now()
    };
  }

  function sendUpdate(force = false) {
    if (!isWhitelisted) return;
    const payload = getPayload();
    if (!payload || !payload.title) {
      if (lastPayloadKey) {
        lastPayloadKey = "";
        browserApi.runtime.sendMessage({ type: "media-clear", source: "generic" }, () => {
          void browserApi.runtime.lastError;
        });
      }
      return;
    }

    const payloadKey = JSON.stringify({
      domain: payload.domain,
      title: payload.title,
      paused: payload.paused,
      ended: payload.ended,
      second: Math.floor(payload.currentTime)
    });

    if (!force && payloadKey === lastPayloadKey) return;
    lastPayloadKey = payloadKey;

    browserApi.runtime.sendMessage({ type: "media-update", media: payload }, () => {
      void browserApi.runtime.lastError;
    });
  }

  function announceSeen() {
    const domain = getEffectiveDomain();
    const mediaTitle = getMediaTitle();
    browserApi.runtime.sendMessage(
      {
        type: "media-seen",
        source: "generic",
        platform: domain,
        url: getEffectiveUrl(),
        hasMediaElement: Boolean(getActiveMediaElement()),
        title: mediaTitle,
        updatedAt: Date.now()
      },
      () => {
        void browserApi.runtime.lastError;
      }
    );
  }

  function checkWhitelist() {
    browserApi.storage.local.get(["rpcWhitelist"], (result) => {
      const whitelist = result.rpcWhitelist || ["youtube.com", "soundcloud.com"];
      const currentDomain = getEffectiveDomain();
      const isAllowed = whitelist.some((d) => currentDomain.endsWith(d));
      if (isAllowed !== isWhitelisted) {
        isWhitelisted = isAllowed;
        if (isWhitelisted) {
          sendUpdate(true);
          announceSeen();
        }
      }
    });
  }

  function bindEvents() {
    const media = getActiveMediaElement();
    if (!media || media.dataset.discordRpcGenericBound === "true") return;

    media.dataset.discordRpcGenericBound = "true";
    ["play", "pause", "seeked", "ratechange", "ended", "loadedmetadata"].forEach((evt) => {
      media.addEventListener(evt, () => {
        if (evt === "play") lastStartedAt = Date.now();
        sendUpdate(true);
      });
    });
  }

  checkWhitelist();
  announceSeen();

  setInterval(() => {
    checkWhitelist();
    if (isWhitelisted) {
      bindEvents();
      const shouldForce = Date.now() - lastForcedAt > FORCE_INTERVAL_MS;
      if (shouldForce) lastForcedAt = Date.now();
      sendUpdate(shouldForce);
      announceSeen();
    }
  }, SEND_INTERVAL_MS);
})();
