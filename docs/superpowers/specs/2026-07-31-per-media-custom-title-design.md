# Design Spec: Per-Media Custom Title & Pre-Filled Title Input

## Overview
Currently, Neurobox allows overriding title, image, target URL, and platform name via the extension control panel. However, title overrides are saved globally per domain (`state.mediaOverrides[domain]`). This causes every video on a site (e.g., YouTube) to share the same custom title. In addition, the title field in the popup starts blank.

This specification introduces:
1. **Per-Media Custom Title Overrides**: Title overrides are scoped to the specific playing media item (`mediaId` / `url`) instead of the entire domain.
2. **Pre-filled Title Input**: When media is playing, the popup's Custom Title input field is automatically pre-filled with the active media's title (or custom title if set), making edits quick and intuitive.

---

## Data Schema & Storage

### Storage Key: `itemOverrides`
In addition to (or upgrading) `mediaOverrides`, we store per-item overrides in `browserApi.storage.local`:

```json
{
  "itemOverrides": {
    "youtube:dQw4w9WgXcQ": {
      "title": "Rick Astley - Never Gonna Give You Up (Custom Title)"
    },
    "generic:https://example.com/watch/movie-1": {
      "title": "Custom Movie Title"
    }
  }
}
```

### Media Identity
A unique key is generated for media items:
- YouTube: `youtube:${videoId}`
- SoundCloud: `soundcloud:${mediaId}`
- Generic sites: `${domain}:${url}` or `generic:${mediaId}`

---

## Component Changes

### 1. `background.js`
- Maintain `itemOverrides` in background state and sync with `browserApi.storage.local`.
- In `applyMediaOverrides(video)`:
  - Check `itemOverrides[mediaKey]` for a media-specific title override.
  - If a media-specific title override exists, use it as `video.title`.
  - Fall back to domain-level overrides for `platform`, `largeImage`, `url`.
- Add message handler `set-item-override`:
  - Receives `{ mediaKey, title, image, url }`.
  - Updates `itemOverrides[mediaKey]` and recalculates active presence.

### 2. `popup.html` & `popup.js`
- When `video` is active in state:
  - If user is NOT actively typing (`document.activeElement !== overrideTitle`):
    - Set `overrideTitle.value = video.customTitle || video.title || ""`.
  - Display helper text or placeholder showing "Pre-filled with detected title".
- When clicking **Save**:
  - Save `overrideTitle.value` for `video.mediaKey` via `set-item-override`.
  - Keep platform name override saved for `currentDomain`.
- When clicking **Reset**:
  - Clear `itemOverrides[video.mediaKey]`.
  - Restore `overrideTitle.value = video.detectedTitle`.

---

## Verification Plan
1. `npm run check` syntax validation.
2. `npm run build` extension build verification.
3. Test title override on a specific video; confirm other videos on the same site retain their original auto-detected titles.
