if (typeof importScripts === "function") {
  try {
    importScripts("config.js");
  } catch (_error) {
    // Firefox MV2 loads config.js from the manifest before this file.
  }
}

const DEFAULT_STATE = {
  authenticated: false,
  connected: false,
  enabled: true,
  showUrl: true,
  showYoutubeChannel: true,
  actionWording: "Auto",
  siteEnabled: {
    youtube: true,
    soundcloud: true
  },
  rpcWhitelist: ["youtube.com", "soundcloud.com"],
  mediaOverrides: {},
  itemOverrides: {},
  lastError: "",
  lastVideo: null,
  lastMediaPage: null,
  lastYouTubePage: null,
  user: null
};

let state = { ...DEFAULT_STATE };
let tokens = null;
let headlessToken = "";
let headlessTokens = [];
let lastPresenceKey = "";
let lastPresenceSentAt = 0;
let pendingOAuth = null;
let mediaBySource = {};
let suppressedBySource = {};
let presenceGeneration = 0;
let presenceWrite = Promise.resolve();

const browserApi = typeof chrome !== "undefined" ? chrome : browser;
const config = globalThis.NEUROBOX_CONFIG || {};
const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_SCOPES = ["openid", "sdk.social_layer_presence"];
const PRESENCE_MIN_INTERVAL_MS = 12000;

function saveState() {
  browserApi.storage.local.set({ rpcState: state });
}

function saveTokens() {
  browserApi.storage.local.set({ discordTokens: tokens });
}

function saveSession() {
  browserApi.storage.local.set({
    rpcSession: {
      headlessToken,
      headlessTokens,
      suppressedBySource
    }
  });
}

function getClientId() {
  return config.discordClientId || "";
}

function callbackPromise(fn) {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const error = browserApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function randomBase64Url(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function requestDiscord(path, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    keepalive: true,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 204) return null;

  const body = await response.json().catch(() => ({}));
  if (response.status === 429) {
    const retryAfter = body.retry_after || 5;
    state = { ...state, lastError: `Rate limited by Discord. Retrying in ${Math.ceil(retryAfter)}s...` };
    saveState();
    return null;
  }
  if (!response.ok) {
    throw new Error(body.message || `Discord API error ${response.status}`);
  }
  return body;
}

async function exchangeToken(params) {
  const body = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: browserApi.identity.getRedirectURL("discord"),
    ...params
  });

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.message || `OAuth error ${response.status}`);
  }

  tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens?.refreshToken || "",
    expiresAt: Date.now() + Math.max((data.expires_in || 3600) - 60, 60) * 1000,
    scope: data.scope || ""
  };
  saveTokens();
  return tokens.accessToken;
}

async function getAccessToken() {
  if (!tokens?.accessToken) throw new Error("Connect Discord first.");
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error("Discord login expired. Connect again.");

  return exchangeToken({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken
  });
}

async function loginDiscord() {
  const clientId = getClientId();
  if (!clientId || clientId.includes("PUT_YOUR")) {
    throw new Error("Set discordClientId in src/extension/config.js first.");
  }

  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const stateValue = randomBase64Url(24);
  const authUrl = new URL("https://discord.com/oauth2/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", browserApi.identity.getRedirectURL("discord"));
  authUrl.searchParams.set("scope", DISCORD_SCOPES.join(" "));
  authUrl.searchParams.set("state", stateValue);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  pendingOAuth = {
    verifier,
    state: stateValue,
    createdAt: Date.now()
  };

  let redirectUrl = "";
  try {
    redirectUrl = await callbackPromise((done) => {
      browserApi.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, done);
    });
  } catch (error) {
    state = {
      ...state,
      lastError: "Firefox did not catch the OAuth redirect. Copy the failed allizom.org URL and paste it here."
    };
    saveState();
    throw error;
  }

  await completeDiscordLogin(redirectUrl);
}

async function completeDiscordLogin(redirectUrl) {
  if (!pendingOAuth || Date.now() - pendingOAuth.createdAt > 10 * 60 * 1000) {
    throw new Error("Start Discord login again before pasting the callback URL.");
  }

  const redirected = new URL(redirectUrl);
  if (redirected.searchParams.get("state") !== pendingOAuth.state) {
    throw new Error("Discord OAuth state mismatch.");
  }

  const code = redirected.searchParams.get("code");
  if (!code) throw new Error(redirected.searchParams.get("error_description") || "Discord did not return an OAuth code.");

  await exchangeToken({
    grant_type: "authorization_code",
    code,
    code_verifier: pendingOAuth.verifier
  });
  pendingOAuth = null;

  const userInfo = await requestDiscord("/oauth2/userinfo");
  state = {
    ...state,
    authenticated: true,
    connected: true,
    user: {
      id: userInfo.sub,
      username: userInfo.preferred_username || userInfo.nickname || userInfo.sub
    },
    lastError: ""
  };
  saveState();
}

function truncate(text, maxLength) {
  if (!text) return "";
  const cleaned = String(text).replace(/[\r\n\t]+/g, " ").trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}...`;
}

function isValidHttpUrl(string) {
  if (!string) return false;
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function makeActivity(video) {
  const now = Date.now();
  const elapsedMs = Math.max(video.currentTime || 0, 0) * 1000;
  const remainingMs = Math.max(video.timeLeft || 0, 0) * 1000;
  const playing = !video.paused && !video.ended && video.duration > 0;
  const platform = video.platform || "Media";
  const selectedWording = video.actionWording || state.actionWording || "Auto";

  let activityType = 3;
  let wordingPrefix = "";
  if (selectedWording === "Watching") {
    activityType = 3;
    wordingPrefix = "Watching";
  } else if (selectedWording === "Listening") {
    activityType = 2;
    wordingPrefix = "Listening to";
  } else if (selectedWording === "Browsing" || selectedWording === "Idling") {
    activityType = 0;
    wordingPrefix = selectedWording === "Browsing" ? "Browsing" : "Idling on";
  } else if (selectedWording === "None") {
    activityType = 0;
    wordingPrefix = "";
  } else {
    activityType = platform === "SoundCloud" || video.action === "Listen" ? 2 : 3;
    wordingPrefix = activityType === 2 ? "Listening to" : "Watching";
  }

  const isDomainName = (str) => Boolean(str && (str.includes(".") || str === video.domain));
  const showUrl = state.showUrl !== false;
  const allowChannel = video.source !== "youtube" || state.showYoutubeChannel !== false;
  const rawAuthor = allowChannel ? video.author : "";
  const displayAuthor = !showUrl && isDomainName(rawAuthor) ? "" : rawAuthor;

  const speedText = video.playbackRate && video.playbackRate !== 1 ? ` (${video.playbackRate}x speed)` : "";

  let stateText = "";
  if (playing) {
    if (displayAuthor) {
      stateText = `by ${displayAuthor}${speedText}`;
    } else {
      if (wordingPrefix) {
        stateText = showUrl ? `${wordingPrefix} on ${platform}${speedText}` : `${wordingPrefix}${speedText}`;
      } else {
        stateText = showUrl ? `${platform}${speedText}` : speedText.trim();
      }
    }
  } else {
    stateText = showUrl ? `Paused on ${platform}` : "Paused";
  }

  const rawLargeImage =
    video.largeImage ||
    (platform === "YouTube" && video.videoId ? `youtube:${video.videoId}` : undefined);
  const validLargeImage = rawLargeImage && (rawLargeImage.startsWith("youtube:") || isValidHttpUrl(rawLargeImage)) ? rawLargeImage : undefined;
  const validSmallImage = isValidHttpUrl(video.channelAvatar) ? video.channelAvatar : undefined;
  const includeUrl = showUrl && isValidHttpUrl(video.url);

  const assets = {
    large_image: validLargeImage,
    large_text: truncate(video.title || platform, 128)
  };

  if (validSmallImage) {
    assets.small_image = validSmallImage;
    assets.small_text = truncate(displayAuthor || platform, 128);
  }

  const buttonLabel = wordingPrefix ? `${wordingPrefix} on ${platform}` : platform;

  const activity = {
    application_id: getClientId(),
    platform: "desktop",
    supported_platforms: ["desktop"],
    type: activityType,
    name: platform,
    details: truncate(video.title || `${wordingPrefix} ${platform}`.trim(), 128),
    state: truncate(stateText, 128),
    assets
  };

  if (includeUrl) {
    activity.assets.large_url = video.url;
    activity.buttons = [
      {
        label: truncate(buttonLabel, 32),
        url: video.url
      }
    ];
    activity.metadata = {
      button_urls: [video.url]
    };
  }

  if (playing) {
    activity.timestamps = {
      start: String(Math.floor(now - elapsedMs)),
      end: String(Math.floor(now + remainingMs))
    };
  }

  return activity;
}

function normalizeUrl(urlStr) {
  if (!urlStr) return "";
  let clean = urlStr.trim();
  if (clean && !/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return isValidHttpUrl(clean) ? clean : urlStr;
}

function presenceKey(video) {
  return JSON.stringify({
    platform: video.platform || "YouTube",
    id: video.mediaId || video.videoId,
    title: video.title,
    author: video.author,
    url: video.url,
    paused: video.paused,
    showUrl: state.showUrl !== false,
    showYoutubeChannel: state.showYoutubeChannel !== false,
    actionWording: state.actionWording || "Auto",
    playbackRate: video.playbackRate || 1,
    bucket: Math.floor((video.currentTime || 0) / 10)
  });
}

function normalizeSource(source) {
  return String(source || "").toLowerCase();
}

function isSourceEnabled(source) {
  const normalized = normalizeSource(source);
  if (!normalized) return true;
  return state.siteEnabled?.[normalized] !== false;
}

function chooseActiveMedia() {
  const now = Date.now();
  const ACTIVE_TIMEOUT_MS = 6000;

  const candidates = Object.values(mediaBySource).filter((media) => {
    if (!state.enabled || !isSourceEnabled(media.source) || media.ended || media.paused || isSuppressed(media)) {
      return false;
    }
    const age = now - (media.updatedAt || 0);
    if (age > ACTIVE_TIMEOUT_MS) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const aStarted = a.lastStartedAt || a.updatedAt || 0;
    const bStarted = b.lastStartedAt || b.updatedAt || 0;
    if (aStarted !== bStarted) return bStarted - aStarted;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  })[0];
}

function mediaIdentity(media) {
  return `${media.source || ""}:${media.mediaId || media.videoId || media.url || ""}`;
}

function isSuppressed(media) {
  const suppressed = suppressedBySource[media.source];
  if (!suppressed) return false;
  if (suppressed.identity !== mediaIdentity(media)) return false;
  if ((media.lastStartedAt || 0) > suppressed.untilStartedAt) return false;
  if ((media.updatedAt || 0) - suppressed.createdAt > 5 * 60 * 1000) return false;
  if ((media.currentTime || 0) < suppressed.currentTime - 2) return false;
  return true;
}

function suppressCurrentMedia(source = "") {
  const sources = source ? [source] : Object.keys(mediaBySource);
  const next = { ...suppressedBySource };
  for (const itemSource of sources) {
    const media = mediaBySource[itemSource];
    if (!media) continue;
    next[itemSource] = {
      identity: mediaIdentity(media),
      untilStartedAt: media.lastStartedAt || media.updatedAt || Date.now(),
      currentTime: media.currentTime || 0,
      createdAt: Date.now()
    };
  }
  suppressedBySource = next;
  saveSession();
}

function bumpPresenceGeneration() {
  presenceGeneration += 1;
}

function rememberHeadlessToken(token) {
  if (!token) return;
  headlessToken = token;
  headlessTokens = Array.from(new Set([...headlessTokens, token])).slice(-8);
  saveSession();
}

function enqueuePresenceUpdate(video, force = false) {
  presenceWrite = presenceWrite
    .catch(() => {})
    .then(() => updatePresence(video, force));
  return presenceWrite;
}

function enqueueClearPresence() {
  presenceWrite = presenceWrite
    .catch(() => {})
    .then(() => performClearPresence());
  return presenceWrite;
}

async function syncActivePresence(force = false) {
  const active = chooseActiveMedia();
  state = { ...state, lastVideo: active };
  saveState();

  if (!active) {
    await enqueueClearPresence();
    return;
  }

  await enqueuePresenceUpdate(active, force);
}

async function updatePresence(video, force = false) {
  if (!state.enabled || !tokens?.accessToken) return;
  if (isSuppressed(video)) return;

  const key = presenceKey(video);
  const now = Date.now();
  if (!force && key === lastPresenceKey && now - lastPresenceSentAt < PRESENCE_MIN_INTERVAL_MS) return;
  const generation = presenceGeneration;

  const body = {
    activities: [makeActivity(video)]
  };
  if (headlessToken) body.token = headlessToken;

  let result = null;
  try {
    result = await requestDiscord("/users/@me/headless-sessions", {
      method: "POST",
      body: JSON.stringify(body)
    });
  } catch (error) {
    state = { ...state, connected: false, lastError: error.message };
    saveState();
    return;
  }

  if (generation !== presenceGeneration || !state.enabled || isSuppressed(video)) {
    await performClearPresence().catch(() => {});
    return;
  }

  rememberHeadlessToken(result?.token || headlessToken);
  lastPresenceKey = key;
  lastPresenceSentAt = now;
  state = { ...state, authenticated: true, connected: true, lastError: "" };
  saveState();
}

async function deleteHeadlessSessionToken(token) {
  if (!token || !tokens?.accessToken) return;

  // Method 1: POST /users/@me/headless-sessions with empty activities and the token
  try {
    await requestDiscord("/users/@me/headless-sessions", {
      method: "POST",
      body: JSON.stringify({ token, activities: [] })
    });
  } catch (_) {}

  // Method 2: POST /users/@me/headless-sessions/delete with token
  try {
    await requestDiscord("/users/@me/headless-sessions/delete", {
      method: "POST",
      body: JSON.stringify({ token })
    });
  } catch (_) {}

  // Method 3: DELETE /users/@me/headless-sessions with token body
  try {
    await requestDiscord("/users/@me/headless-sessions", {
      method: "DELETE",
      body: JSON.stringify({ token })
    });
  } catch (_) {}

  // Method 4: DELETE /users/@me/headless-sessions?token=...
  try {
    await requestDiscord(`/users/@me/headless-sessions?token=${encodeURIComponent(token)}`, {
      method: "DELETE"
    });
  } catch (_) {}
}

async function performClearPresence() {
  bumpPresenceGeneration();
  lastPresenceKey = "";
  lastPresenceSentAt = 0;

  if (!tokens?.accessToken) {
    headlessToken = "";
    headlessTokens = [];
    saveSession();
    return;
  }

  const tokensToDelete = Array.from(new Set([headlessToken, ...headlessTokens].filter(Boolean)));

  if (tokensToDelete.length > 0) {
    await Promise.allSettled(tokensToDelete.map((t) => deleteHeadlessSessionToken(t)));
  } else {
    await requestDiscord("/users/@me/headless-sessions", {
      method: "POST",
      body: JSON.stringify({ activities: [] })
    }).catch(() => {});
  }

  headlessToken = "";
  headlessTokens = [];
  saveSession();
}

async function clearPresence({ waitForWrites = true } = {}) {
  if (waitForWrites) {
    await enqueueClearPresence();
  } else {
    await performClearPresence();
  }
}

async function clearActivePresence() {
  suppressCurrentMedia();
  state = { ...state, lastVideo: null, lastError: "" };
  saveState();
  await enqueueClearPresence();
}

async function logoutDiscord() {
  await clearActivePresence().catch(() => {});
  tokens = null;
  headlessToken = "";
  headlessTokens = [];
  lastPresenceKey = "";
  browserApi.storage.local.remove(["discordTokens", "rpcSession"]);
  state = { ...DEFAULT_STATE, enabled: state.enabled };
  saveState();
}

function getMediaKey(video) {
  if (!video) return "";
  const id = video.videoId || video.mediaId || video.url || "";
  return `${video.source || "media"}:${id}`;
}

function applyMediaOverrides(video) {
  if (!video) return video;
  const domain = video.domain || video.source;
  const domainOverrides = state.mediaOverrides?.[domain] || {};
  const mediaKey = getMediaKey(video);
  const itemOverride = state.itemOverrides?.[mediaKey] || {};

  const customTitle = itemOverride.title !== undefined ? itemOverride.title : (domainOverrides.title || "");
  const resolvedTitle = customTitle || video.title;

  return {
    ...video,
    mediaKey,
    platform: domainOverrides.platform || video.platform,
    title: resolvedTitle,
    customTitle,
    thumbnail: itemOverride.image || domainOverrides.image || video.thumbnail,
    largeImage: itemOverride.image || domainOverrides.image || video.largeImage,
    url: itemOverride.url ? normalizeUrl(itemOverride.url) : (domainOverrides.url ? normalizeUrl(domainOverrides.url) : video.url)
  };
}

function isGenericTitleString(str) {
  if (!str) return true;
  const s = str.trim().toLowerCase();
  return /^(player|video|watch|stream|play|html5 player|jw player|video player|\w+\.php|\w+\.html)$/i.test(s) || s.endsWith(".php") || s.endsWith(".html");
}

function handleVideoUpdate(video, senderTabId) {
  const source = normalizeSource(video.source || video.platform || "youtube");
  const tabId = senderTabId !== undefined ? senderTabId : video.tabId;
  const storageKey = tabId !== undefined ? `${tabId}:${source}` : source;

  const previous = mediaBySource[storageKey];
  const pageTitle = state.lastMediaPage?.title;

  let resolvedTitle = video.title;
  if (isGenericTitleString(resolvedTitle) && pageTitle && !isGenericTitleString(pageTitle)) {
    resolvedTitle = pageTitle;
  }

  const isSameMedia = previous && (
    (video.videoId && previous.videoId === video.videoId) ||
    (video.mediaId && previous.mediaId === video.mediaId) ||
    (video.url && previous.url === video.url)
  );

  const mediaChanged = !isSameMedia;
  const becamePlaying = mediaChanged ? !video.paused : (previous?.paused && !video.paused);
  const lastStartedAt = (becamePlaying || mediaChanged || !previous?.lastStartedAt)
    ? Date.now()
    : previous.lastStartedAt;

  const media = applyMediaOverrides({
    ...video,
    tabId,
    title: resolvedTitle,
    source,
    lastStartedAt,
    updatedAt: Date.now()
  });

  const suppressed = suppressedBySource[source];
  if (
    !media.paused &&
    suppressed &&
    suppressed.identity === mediaIdentity(media) &&
    (media.lastStartedAt || 0) > suppressed.untilStartedAt
  ) {
    const nextSuppressed = { ...suppressedBySource };
    delete nextSuppressed[source];
    suppressedBySource = nextSuppressed;
    saveSession();
  }

  if (media.paused || media.ended) {
    delete mediaBySource[storageKey];
  } else {
    mediaBySource[storageKey] = media;
  }

  const active = chooseActiveMedia();
  state = { ...state, lastVideo: active };
  saveState();

  if (!state.enabled || !active || !isSourceEnabled(active.source)) {
    syncActivePresence(true).catch(() => {});
    return;
  }

  enqueuePresenceUpdate(active).catch((error) => {
    state = { ...state, connected: false, lastError: error.message };
    saveState();
  });
}

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  const senderTabId = sender.tab?.id;

  if (message.type === "youtube-video") {
    handleVideoUpdate({ platform: "YouTube", source: "youtube", action: "Watch", mediaId: message.video.videoId, ...message.video }, senderTabId);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "media-update") {
    handleVideoUpdate(message.media, senderTabId);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "youtube-seen") {
    state = { ...state, lastYouTubePage: message, lastMediaPage: { ...message, platform: "YouTube" } };
    saveState();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "media-seen") {
    state = { ...state, lastMediaPage: message };
    saveState();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "youtube-clear" || message.type === "media-clear") {
    const source = normalizeSource(message.source || (message.type === "youtube-clear" ? "youtube" : ""));
    suppressCurrentMedia(source);
    if (source) {
      const next = { ...mediaBySource };
      delete next[source];
      mediaBySource = next;
    } else {
      mediaBySource = {};
    }
    syncActivePresence(true).catch((error) => {
      state = { ...state, lastError: error.message };
      saveState();
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "get-state") {
    sendResponse(state);
    return true;
  }

  if (message.type === "set-enabled") {
    state = { ...state, enabled: Boolean(message.enabled), lastError: "" };
    saveState();
    const operation = state.enabled ? syncActivePresence(true) : clearActivePresence();
    operation
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, connected: false, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "set-show-url") {
    state = { ...state, showUrl: Boolean(message.showUrl), lastError: "" };
    saveState();
    syncActivePresence(true)
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, connected: false, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "set-show-youtube-channel") {
    state = { ...state, showYoutubeChannel: Boolean(message.showYoutubeChannel), lastError: "" };
    saveState();
    syncActivePresence(true)
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, connected: false, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "set-action-wording") {
    state = { ...state, actionWording: message.wording || "Auto", lastError: "" };
    saveState();
    syncActivePresence(true)
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, connected: false, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "set-site-enabled") {
    const source = normalizeSource(message.source);
    state = {
      ...state,
      siteEnabled: {
        ...DEFAULT_STATE.siteEnabled,
        ...(state.siteEnabled || {}),
        [source]: Boolean(message.enabled)
      },
      lastError: ""
    };
    if (!state.siteEnabled[source]) {
      suppressCurrentMedia(source);
      const next = { ...mediaBySource };
      delete next[source];
      mediaBySource = next;
    }
    saveState();
    syncActivePresence(true)
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "clear-presence") {
    clearActivePresence()
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "login-discord") {
    loginDiscord()
      .then(() => {
        return syncActivePresence(true);
      })
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, authenticated: false, connected: false, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "complete-oauth-callback") {
    completeDiscordLogin(message.url)
      .then(() => {
        return syncActivePresence(true);
      })
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, authenticated: false, connected: false, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "logout-discord") {
    logoutDiscord()
      .then(() => sendResponse(state))
      .catch((error) => {
        state = { ...state, lastError: error.message };
        saveState();
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "toggle-domain-whitelist") {
    const domain = message.domain;
    const whitelist = state.rpcWhitelist || ["youtube.com", "soundcloud.com"];
    const exists = whitelist.includes(domain);
    const updatedWhitelist = exists ? whitelist.filter((d) => d !== domain) : [...whitelist, domain];
    state = { ...state, rpcWhitelist: updatedWhitelist };
    browserApi.storage.local.set({ rpcWhitelist: updatedWhitelist });
    sendResponse({ ok: true, isWhitelisted: !exists, whitelist: updatedWhitelist });
    return true;
  }

  if (message.type === "set-domain-override") {
    const { domain, title, image, url, platform } = message;
    const overrides = { ...(state.mediaOverrides || {}) };
    if (!title && !image && !url && !platform) {
      delete overrides[domain];
    } else {
      overrides[domain] = { title, image, url, platform };
    }
    state = { ...state, mediaOverrides: overrides };
    browserApi.storage.local.set({ mediaOverrides: overrides });
    syncActivePresence(true);
    sendResponse({ ok: true, overrides });
    return true;
  }

  if (message.type === "set-item-override") {
    const { mediaKey, title, image, url } = message;
    const itemOverrides = { ...(state.itemOverrides || {}) };
    if (!title && !image && !url) {
      delete itemOverrides[mediaKey];
    } else {
      itemOverrides[mediaKey] = { title, image, url };
    }
    state = { ...state, itemOverrides };
    browserApi.storage.local.set({ itemOverrides });
    syncActivePresence(true);
    sendResponse({ ok: true, itemOverrides });
    return true;
  }

  return false;
});

function initStorage() {
  browserApi.storage.local.get(["rpcState", "discordTokens", "rpcSession", "rpcWhitelist", "mediaOverrides", "itemOverrides"], (result) => {
    state = { ...DEFAULT_STATE, ...(result.rpcState || {}) };
    state.rpcWhitelist = result.rpcWhitelist || ["youtube.com", "soundcloud.com"];
    state.mediaOverrides = result.mediaOverrides || {};
    state.itemOverrides = result.itemOverrides || {};
    state.siteEnabled = { ...DEFAULT_STATE.siteEnabled, ...(state.siteEnabled || {}) };
    tokens = result.discordTokens || null;
    headlessToken = result.rpcSession?.headlessToken || "";
    headlessTokens = result.rpcSession?.headlessTokens || (headlessToken ? [headlessToken] : []);
    suppressedBySource = result.rpcSession?.suppressedBySource || {};
    state = { ...state, authenticated: Boolean(tokens?.accessToken), connected: Boolean(tokens?.accessToken) };
    saveState();
  });
}

browserApi.runtime.onInstalled.addListener(initStorage);
initStorage();

function cleanupTabMedia(tabId) {
  let changed = false;
  const nextMedia = { ...mediaBySource };
  for (const [src, media] of Object.entries(nextMedia)) {
    if (media.tabId === tabId) {
      delete nextMedia[src];
      changed = true;
    }
  }
  if (changed) {
    mediaBySource = nextMedia;
    syncActivePresence(true).catch(() => {});
  }
}

if (browserApi.tabs && browserApi.tabs.onRemoved) {
  browserApi.tabs.onRemoved.addListener((tabId) => {
    cleanupTabMedia(tabId);
  });
}

if (browserApi.tabs && browserApi.tabs.onUpdated) {
  browserApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading" && changeInfo.url) {
      cleanupTabMedia(tabId);
    }
  });
}

if (browserApi.windows && browserApi.windows.onRemoved) {
  browserApi.windows.onRemoved.addListener(() => {
    if (browserApi.windows.getAll) {
      browserApi.windows.getAll({ populate: false }, (windows) => {
        if (!windows || windows.length === 0) {
          mediaBySource = {};
          clearActivePresence().catch(() => {});
        }
      });
    }
  });
}

if (browserApi.runtime && browserApi.runtime.onSuspend) {
  browserApi.runtime.onSuspend.addListener(() => {
    clearPresence({ waitForWrites: false }).catch(() => {});
  });
}

// Background heartbeat to purge stale or paused media, verify tabs, and maintain Discord presence consistency
setInterval(() => {
  const now = Date.now();
  const STALE_THRESHOLD_MS = 8000;
  let changed = false;
  const nextMedia = { ...mediaBySource };

  for (const [src, media] of Object.entries(nextMedia)) {
    const age = now - (media.updatedAt || 0);
    if (age > STALE_THRESHOLD_MS || media.paused) {
      delete nextMedia[src];
      changed = true;
      continue;
    }

    if (media.tabId !== undefined && browserApi.tabs && browserApi.tabs.get) {
      browserApi.tabs.get(media.tabId, (tab) => {
        if (browserApi.runtime.lastError || !tab) {
          if (mediaBySource[src]?.tabId === media.tabId) {
            const current = { ...mediaBySource };
            delete current[src];
            mediaBySource = current;
            syncActivePresence(true).catch(() => {});
          }
        }
      });
    }
  }

  if (changed) {
    mediaBySource = nextMedia;
  }

  syncActivePresence(false).catch(() => {});
}, 3000);


