# Neurobox - Discord RPC Extension

Shows the currently playing YouTube video or SoundCloud track in Discord Rich Presence from Chrome, Edge, or Firefox.

This uses Discord OAuth with `openid sdk.social_layer_presence` and updates a Discord headless session from the extension. No native host required.

## Quick Note (Important) - Read PRIVACY.md for more information

The Discord OAuth scope of `sdk.social_layer_presence` requests a plethora of other unrelated permissions which many users would consider to be potentially harmful. That, however, is not the case. The scopes that allow the app to set your activity (`rpc.activities.write` and `activities.write`) are currently LOCKED by Discord. They do not give out access to those via applications or support requests, and only a select few Developers are whitelisted to use it. But, `sdk.social_layer_presence` (which is not locked) does implicitly grant developers access to said scope alongside many others that are not available individually. So, unfortunately, in order to set the user's activity, the extension needs to request a lot of unrelated permissions. I apologize for this in advance and can only hope that Discord allows developers to use these scopes without any restrictions in the coming future.

### Copyright (C) 2026 Sheathed

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.