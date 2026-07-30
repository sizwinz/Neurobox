# Privacy Policy

Last updated: July 31, 2026

## Overview

Neurobox Media Discord RPC is a browser extension that displays your active media playback (from YouTube, SoundCloud, or any whitelisted video/audio streaming website) as Discord Rich Presence.

The extension does not sell personal data, does not serve advertisements, and does not collect tracking telemetry or analytics.

---

## Important Note Regarding Discord OAuth Scopes

The Discord OAuth scope `sdk.social_layer_presence` requests permissions that sound broad. Discord's individual activity-writing scopes (`rpc.activities.write` and `activities.write`) are locked by Discord and reserved for whitelisted developer applications. The `sdk.social_layer_presence` scope allows the extension to create and update your Discord activity via headless sessions without running a local RPC desktop server.

---

## Data the Extension Reads

When media tracking is enabled and a website is whitelisted by the user, the extension reads basic playback metadata:

- Platform or site domain name (e.g. YouTube, SoundCloud, or custom site)
- Media title and uploader/artist name
- Playback position, total duration, and playback state (playing, paused, speed)
- Page URL and poster artwork URL (when available)

The extension only injects media listeners on sites authorized by the user via the domain whitelist.

---

## User Privacy & Control Options

You have full control over what data is sent to Discord:

- **Show URL Toggle**: When disabled, page URLs and domain names are stripped from Discord activity text and buttons.
- **Custom Target URL**: Allows you to replace the destination link with a custom link of your choice.
- **Custom Official Platform Name**: Allows you to rename third-party streaming sites to an official service name (e.g. Netflix, Prime Video).
- **Status Wording Controls**: Customize or disable action wording prefixes (*Watching*, *Listening to*, *Browsing*, *Idling on*, or *None*).
- **YouTube Channel Toggle**: Toggle whether the uploader's channel name appears in your status.

---

## Local Data Storage

All settings are stored strictly on your local device inside your browser's extension storage (`chrome.storage.local` / `browser.storage.local`):

- Discord OAuth authentication tokens
- User domain whitelist (`rpcWhitelist`)
- Domain overrides (`mediaOverrides`)
- Extension preferences (`showUrl`, `showYoutubeChannel`, `actionWording`)

No data is sent to external developer servers, analytics services, or third parties other than Discord.

---

## Data Sharing

Playback information is transmitted directly to Discord's official OAuth API (`https://discord.com/api/v10`) solely to display your Rich Presence activity. Discord displays this activity according to your Discord account privacy settings.

---

## Contact

For questions or security inquiries:

me@yaw.cx
