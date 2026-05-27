# Privacy Policy

Last updated: May 27, 2026

## Overview

Neurobox Media Discord RPC is a browser extension that shows your currently playing YouTube or SoundCloud media as Discord Rich Presence.

The extension does not sell personal data, does not run ads, and does not use analytics.

## Quick Note (Important)

The Discord OAuth scope of `sdk.social_layer_presence` requests a plethora of other unrelated permissions which many users would consider to be potentially harmful. That, however, is not the case. The scopes that allow the app to set your activity (`rpc.activities.write` and `activities.write`) are currently LOCKED by Discord. They do not give out access to those via applications or support requests, and only a select few Developers are whitelisted to use it. But, `sdk.social_layer_presence` (which is not locked) does implicitly grant developers access to said scope alongside many others that are not available individually. So, unfortunately, in order to set the user's activity, the extension needs to request a lot of unrelated permissions. I apologize for this in advance and can only hope that Discord allows developers to use these scopes without any restrictions in the coming future.

## Data the Extension Reads

When enabled, the extension reads limited playback information from supported media sites:

- Site name, such as YouTube or SoundCloud
- Media title
- Channel, uploader, or artist name
- Current playback time and duration
- Playback state, such as playing or paused
- Media URL
- Artwork or thumbnail URL, when available

The extension reads this information only from supported pages that match its declared permissions.

## How Data Is Used

Playback information is used to create or update your Discord Rich Presence activity.

To do this, the extension sends the current activity data to Discord using Discord's OAuth-authorized API. Discord may display this activity to other users according to your Discord privacy and activity settings.

## Discord Authentication

The extension uses Discord OAuth to request permission for presence-related functionality. OAuth tokens are stored locally in your browser extension storage so the extension can keep your Rich Presence updated while you use it.

The extension does not receive or store your Discord password.

## Data Storage

The extension stores the following data locally in your browser:

- Discord OAuth tokens
- Extension settings, such as whether YouTube or SoundCloud presence is enabled
- Temporary session data used to update or clear Discord Rich Presence

This data stays on your device unless it is sent to Discord as part of the Rich Presence functionality.

## Data Sharing

The extension sends playback activity data to Discord only when you connect Discord and enable presence updates.

The extension does not share data with the developer, advertisers, analytics providers, or any third-party service other than Discord for the purpose of updating Rich Presence.

## User Controls

You can:

- Enable or disable all presence updates from the extension popup
- Enable or disable supported sites individually
- Clear your current Discord presence from the extension popup
- Disconnect Discord from the extension popup
- Revoke the extension's Discord authorization from your Discord account settings
- Remove locally stored extension data by uninstalling the extension or clearing extension storage

## Contact

For questions or issues:

me@yaw.cx
