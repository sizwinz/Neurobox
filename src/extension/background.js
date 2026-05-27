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
  siteEnabled: {
    youtube: true,
    soundcloud: true
  },
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 204) return null;

  const body = await response.json().catch(() => ({}));
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
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function makeActivity(video) {
  const now = Date.now();
  const elapsedMs = Math.max(video.currentTime || 0, 0) * 1000;
  const remainingMs = Math.max(video.timeLeft || 0, 0) * 1000;
  const playing = !video.paused && !video.ended && video.duration > 0;
  const platform = video.platform || "Media";
  const action = video.action || (platform === "SoundCloud" ? "Listen" : "Watch");
  const activityType = platform === "SoundCloud" ? 2 : 3;
  const largeImage =
    video.largeImage ||
    (platform === "YouTube" && video.videoId ? `youtube:${video.videoId}` : undefined);
  const stateText = video.author ? `by ${video.author}` : platform;
  const activity = {
    application_id: getClientId(),
    platform: "desktop",
    supported_platforms: ["desktop"],
    type: activityType,
    name: platform,
    details: truncate(video.title || `${action}ing ${platform}`, 128),
    state: truncate(playing ? stateText : `${stateText} - Paused`, 128),
    assets: {
      large_image: largeImage,
      large_text: truncate(video.title || platform, 128),
      large_url: video.url
    },
    buttons: [
      {
        label: `${action} on ${platform}`,
        url: video.url
      }
    ],
    metadata: {
      button_urls: [video.url]
    }
  };

  if (playing) {
    activity.timestamps = {
      start: String(Math.floor(now - elapsedMs)),
      end: String(Math.floor(now + remainingMs))
    };
  }

  return activity;
}

function presenceKey(video) {
  return JSON.stringify({
    platform: video.platform || "YouTube",
    id: video.mediaId || video.videoId,
    title: video.title,
    author: video.author,
    paused: video.paused,
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
  return Object.values(mediaBySource)
    .filter((media) => state.enabled && isSourceEnabled(media.source) && !media.ended && !isSuppressed(media))
    .sort((a, b) => {
      const aStarted = a.lastStartedAt || 0;
      const bStarted = b.lastStartedAt || 0;
      if (aStarted !== bStarted) return bStarted - aStarted;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    })[0] || null;
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

async function syncActivePresence(force = false) {
  const active = chooseActiveMedia();
  state = { ...state, lastVideo: active };
  saveState();

  if (!active) {
    await clearPresence();
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

  const result = await requestDiscord("/users/@me/headless-sessions", {
    method: "POST",
    body: JSON.stringify(body)
  });

  if (generation !== presenceGeneration || !state.enabled || isSuppressed(video)) {
    await clearPresence({ waitForWrites: false }).catch(() => {});
    return;
  }

  rememberHeadlessToken(result.token || headlessToken);
  lastPresenceKey = key;
  lastPresenceSentAt = now;
  state = { ...state, authenticated: true, connected: true, lastError: "" };
  saveState();
}

async function clearPresence({ waitForWrites = true } = {}) {
  bumpPresenceGeneration();
  lastPresenceKey = "";
  lastPresenceSentAt = 0;
  if (!tokens?.accessToken) {
    headlessToken = "";
    headlessTokens = [];
    saveSession();
    return;
  }

  if (waitForWrites) {
    await presenceWrite.catch(() => {});
  }

  const tokensToDelete = Array.from(new Set([headlessToken, ...headlessTokens].filter(Boolean)));
  headlessToken = "";
  headlessTokens = [];
  saveSession();

  if (tokensToDelete.length) {
    await Promise.allSettled(
      tokensToDelete.map((token) =>
        requestDiscord("/users/@me/headless-sessions/delete", {
          method: "POST",
          body: JSON.stringify({ token })
        })
      )
    );
  }

  await requestDiscord("/users/@me/headless-sessions", {
    method: "POST",
    body: JSON.stringify({ activities: [] })
  }).catch(() => {});
}

async function clearActivePresence() {
  suppressCurrentMedia();
  state = { ...state, lastVideo: null, lastError: "" };
  saveState();
  await clearPresence();
}

async function logoutDiscord() {
  await clearActivePresence().catch(() => {});
  tokens = null;
  headlessToken = "";
  headlessTokens = [];
  lastPresenceKey = "";
  browserApi.storage.local.remove("discordTokens");
  state = { ...DEFAULT_STATE, enabled: state.enabled };
  saveState();
}

function handleVideoUpdate(video) {
  const source = normalizeSource(video.source || video.platform || "youtube");
  const previous = mediaBySource[source];
  const becamePlaying = previous ? previous.paused && !video.paused : !video.paused;
  const media = {
    ...previous,
    ...video,
    source,
    lastStartedAt: video.lastStartedAt || (becamePlaying ? Date.now() : previous?.lastStartedAt || video.updatedAt || Date.now())
  };
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
  mediaBySource = { ...mediaBySource, [source]: media };
  const active = chooseActiveMedia();
  state = { ...state, lastVideo: active };
  saveState();

  if (!state.enabled || !active || active.source !== source || !isSourceEnabled(source)) return;
  enqueuePresenceUpdate(active).catch((error) => {
    state = { ...state, connected: false, lastError: error.message };
    saveState();
  });
}

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "youtube-video") {
    handleVideoUpdate({ platform: "YouTube", source: "youtube", action: "Watch", mediaId: message.video.videoId, ...message.video });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "media-update") {
    handleVideoUpdate(message.media);
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
      if (next[source]) {
        next[source] = { ...next[source], ended: true, paused: true, updatedAt: Date.now() };
      } else {
        delete next[source];
      }
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

  return false;
});

browserApi.runtime.onInstalled.addListener(() => {
  browserApi.storage.local.get(["rpcState", "discordTokens", "rpcSession"], (result) => {
    state = { ...DEFAULT_STATE, ...(result.rpcState || {}) };
    state.siteEnabled = { ...DEFAULT_STATE.siteEnabled, ...(state.siteEnabled || {}) };
    tokens = result.discordTokens || null;
    headlessToken = result.rpcSession?.headlessToken || "";
    headlessTokens = result.rpcSession?.headlessTokens || (headlessToken ? [headlessToken] : []);
    suppressedBySource = result.rpcSession?.suppressedBySource || {};
    state = { ...state, authenticated: Boolean(tokens?.accessToken), connected: Boolean(tokens?.accessToken) };
    saveState();
  });
});

browserApi.storage.local.get(["rpcState", "discordTokens", "rpcSession"], (result) => {
  state = { ...DEFAULT_STATE, ...(result.rpcState || {}) };
  state.siteEnabled = { ...DEFAULT_STATE.siteEnabled, ...(state.siteEnabled || {}) };
  tokens = result.discordTokens || null;
  headlessToken = result.rpcSession?.headlessToken || "";
  headlessTokens = result.rpcSession?.headlessTokens || (headlessToken ? [headlessToken] : []);
  suppressedBySource = result.rpcSession?.suppressedBySource || {};
  state = { ...state, authenticated: Boolean(tokens?.accessToken), connected: Boolean(tokens?.accessToken) };
  saveState();
});
