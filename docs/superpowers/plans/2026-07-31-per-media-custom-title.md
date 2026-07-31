# Per-Media Custom Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to override custom titles per specific media item (rather than site-wide) and pre-fill the popup's title input with the detected video title for fast editing.

**Architecture:** Extend extension state with `itemOverrides` mapping `mediaKey` to custom properties (specifically `title`). Pre-fill popup input field with `video.title` when popup opens or active video changes.

**Tech Stack:** JavaScript (ES6+), WebExtension API (`chrome.storage.local` / `browser.storage.local`), HTML5.

## Global Constraints

- Preserve browser compatibility across Chromium and Firefox MV2/MV3.
- Use `npm run check` and `npm run build` for runtime and build verification.

---

### Task 1: Background State & Message Handler for Per-Media Overrides

**Files:**
- Modify: `src/extension/background.js`

**Interfaces:**
- Consumes: `video` object containing `mediaId`, `videoId`, `url`, `source`
- Produces: `itemOverrides` in `state` and `storage.local`, `set-item-override` message listener

- [ ] **Step 1: Update background state initialization and `applyMediaOverrides`**

In `src/extension/background.js`, add `itemOverrides: {}` to `DEFAULT_STATE` and `initStorage()`.
Update `applyMediaOverrides(video)`:
```javascript
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

  const resolvedTitle = itemOverride.title || domainOverrides.title || video.title;

  return {
    ...video,
    mediaKey,
    platform: domainOverrides.platform || video.platform,
    title: resolvedTitle,
    customTitle: itemOverride.title || domainOverrides.title || "",
    thumbnail: itemOverride.image || domainOverrides.image || video.thumbnail,
    largeImage: itemOverride.image || domainOverrides.image || video.largeImage,
    url: itemOverride.url ? normalizeUrl(itemOverride.url) : (domainOverrides.url ? normalizeUrl(domainOverrides.url) : video.url)
  };
}
```

- [ ] **Step 2: Add `set-item-override` message handler to background listener**

Add `set-item-override` to `browserApi.runtime.onMessage`:
```javascript
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
```

- [ ] **Step 3: Run check script**

Run: `npm run check`
Expected output: `js ok: src/extension/background.js`

- [ ] **Step 4: Commit changes**

```bash
git add src/extension/background.js
git commit -m "feat: add per-media itemOverrides and set-item-override handler"
```

---

### Task 2: Pre-fill & Per-Media Title Handling in Popup

**Files:**
- Modify: `src/extension/popup.js`

**Interfaces:**
- Consumes: `state.lastVideo` (including `video.mediaKey`, `video.title`, `video.customTitle`)
- Produces: Pre-filled title input, per-media save & reset message calls

- [ ] **Step 1: Update popup `updateDomainUI` and `render` logic**

In `src/extension/popup.js`:
Update `render(state)` / `updateDomainUI(state)` so that when active media is present (`video = state.lastVideo`), if the user is not actively typing in `overrideTitle` (`document.activeElement !== overrideTitle`), pre-fill `overrideTitle.value` with `video.customTitle || video.title || ""`.

```javascript
  const video = state.lastVideo;
  if (video && document.activeElement !== overrideTitle) {
    overrideTitle.value = video.customTitle || video.title || "";
  }
```

- [ ] **Step 2: Update `saveOverride` and `resetOverride` button click listeners**

In `src/extension/popup.js`:
Update `saveOverride` click listener:
```javascript
saveOverride.addEventListener("click", () => {
  const video = state.lastVideo;
  const newTitle = overrideTitle.value.trim();
  const newImage = overrideImage.value.trim();
  const newUrl = overrideUrl.value.trim();
  const newPlatform = overridePlatform.value.trim();

  if (video && video.mediaKey) {
    browserApi.runtime.sendMessage(
      { type: "set-item-override", mediaKey: video.mediaKey, title: newTitle, image: newImage, url: newUrl },
      () => refresh()
    );
  }

  if (currentDomain && newPlatform) {
    browserApi.runtime.sendMessage(
      { type: "set-domain-override", domain: currentDomain, platform: newPlatform },
      () => refresh()
    );
  }
});
```

Update `resetOverride` click listener:
```javascript
resetOverride.addEventListener("click", () => {
  const video = state.lastVideo;
  if (video && video.mediaKey) {
    browserApi.runtime.sendMessage(
      { type: "set-item-override", mediaKey: video.mediaKey, title: "", image: "", url: "" },
      () => {
        overrideTitle.value = video.title || "";
        refresh();
      }
    );
  }
  overrideImage.value = "";
  overrideUrl.value = "";
  overridePlatform.value = "";
});
```

- [ ] **Step 3: Run check script**

Run: `npm run check`
Expected output: `js ok: src/extension/popup.js`

- [ ] **Step 4: Commit changes**

```bash
git add src/extension/popup.js
git commit -m "feat: pre-fill custom title input and save per-media title overrides"
```

---

### Task 3: Build & Verification

**Files:**
- Verify: All files via check and build scripts

- [ ] **Step 1: Run check script**

Run: `npm run check`
Expected output: Exit code 0 with all json and js files ok.

- [ ] **Step 2: Run build script**

Run: `npm run build`
Expected output: Both chromium and firefox builds created in `dist/`.

- [ ] **Step 3: Commit build updates if any**

```bash
git add dist/ manifests/
git commit -m "build: package updated extension with per-media custom titles"
```
