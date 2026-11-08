# Firefox Add-ons (AMO) listing

Fields for [addons.mozilla.org/developers](https://addons.mozilla.org/developers/), in the order the submission flow asks for them. Character limits are noted where AMO has them.

---

## 1. Upload

- **Where to host:** On this site (listed on addons.mozilla.org).
- **Platforms:** Firefox and Firefox for Android. The extension works on YouTube's mobile site, with simpler placement.
- **File:** the release zip from GitHub Releases, for example `detour-0.4.0.zip`. The same package works for Chrome and Firefox. Firefox ignores the Chrome-only `background.service_worker` key and uses `background.scripts`.

### Source code question

> Do you need to submit source code? (Do you use code generators, minifiers, template engines, or transpilers?)

**No.** The package is the source: plain JavaScript, HTML and CSS, with no build step, bundling or minification. `scripts/build.sh` only zips the files.

---

## 2. Describe add-on

### Name (max 50)

```
Detour
```

### Add-on URL

```
https://addons.mozilla.org/firefox/addon/detour-nebula-floatplane/
```

If `detour` is free, use it. Otherwise use the slug above.

### Summary (max 250)

```
See when a YouTube video or channel is also on Nebula or Floatplane, and watch it there instead: a button next to the video title, or an automatic redirect if you subscribe. No server, no analytics.
```

(198 characters)

### Description

AMO supports basic formatting in this field: line breaks, bullet lists and links.

```
Detour shows you when a YouTube video or channel is also on Nebula or Floatplane, so you can watch it where you already pay to support the creator.

<b>On a video</b>
A "Watch on Nebula" or "Watch on Floatplane" button appears next to the video's title. If you subscribe to that platform, Detour can take you there automatically, with a 3-second countdown and a "Stay on YouTube" option. Or you can choose to just show the button.

<b>On a channel</b>
A banner under the Subscribe button lets you know the creator is also on Nebula or Floatplane, with a link to their channel there. Dismiss it once and it stays hidden for that channel.

<b>You're in control</b>
• Tell Detour which subscriptions you have: Nebula, and the individual Floatplane creators you support
• Choose between automatic redirects or just a button
• Open the other site in a new tab instead of leaving YouTube
• Pick which platform wins when a video is on both
• Light and dark themes follow YouTube and your system

<b>How it works</b>
Detour matches the YouTube channel to the creator's Nebula or Floatplane channel, then compares video titles and release dates to find the same video. If the exact video can't be found, you get a link to the creator's channel instead, and Detour never redirects you on a guess.

<b>Private by design</b>
Detour has no server and collects no analytics. It talks only to Nebula and Floatplane, directly from your browser, and only for creators who are on those platforms. Your Floatplane login stays with floatplane.com. Firefox will ask you to allow this when you install, because Detour sends the titles of those creators' videos to Nebula and Floatplane to find matches.

<b>Open source</b>
<a href="https://github.com/josh345rtfvqw/detour">github.com/josh345rtfvqw/detour</a>

Detour is an independent project and is not affiliated with or endorsed by YouTube, Google, Nebula or Floatplane.
```

### Categories (pick up to 2)

- **Photos, Music & Videos** (main)
- **Other**, if you want a second one. None of the remaining categories fit better.

### Tags

```
youtube, nebula, floatplane, video, redirect, creators
```

### Support

- **Homepage:** `https://josh345rtfvqw.github.io/detour/`

- **Support email:** leave blank, or use an address you're happy to publish.
- **Support website:** `https://josh345rtfvqw.github.io/detour/SUPPORT.html`

### License

**MIT License.** It matches `LICENSE` in the repository.

### Privacy policy

AMO asks for the policy as **text**, not a link. Paste the text of [`PRIVACY.md`](../PRIVACY.md), the same policy published at https://josh345rtfvqw.github.io/detour/PRIVACY.html. It covers what's sent to Nebula and Floatplane, what's stored, and that there's no server or analytics. That matches the `browsingActivity` and `websiteContent` data collection declared in the manifest.

### "Requires payment, non-free services or software"

**Leave unticked.** Detour works without any subscription: it shows "Also on Nebula/Floatplane" buttons and channel links to everyone. Subscriptions only unlock the optional auto-redirect, and the description says so.

---

## 3. Notes to reviewer

AMO reviewers read the code. This field helps them test quickly and understand the permissions:

```
Detour shows a link to (or optionally redirects to) the same video on Nebula or Floatplane when a user is on YouTube. Everything ships in the package; there is no build step, minification or remote code. Source: https://github.com/josh345rtfvqw/detour

HOW TO TEST (no account needed)
1. Install, open the toolbar popup, tick "I subscribe to Nebula", choose "Show a button".
2. Open a YouTube video from a creator on Nebula (for example a recent Real Engineering, Wendover Productions or Half as Interesting upload). A "Watch on Nebula" chip appears at the right of the video title.
3. Open that creator's YouTube channel page: a banner appears under the Subscribe button.
4. Switch the popup to "Redirect me" and open another of their videos: a 3-second countdown appears, then the Nebula page opens. Pressing Back stays on YouTube.
Floatplane matching uses the user's floatplane.com session for the creator list; without logging in, a built-in list of known creators is used and links go to channels.

NETWORK REQUESTS (all from the background script, all disclosed in the privacy policy)
- talent.nebula.tv/creators: Nebula's public creator list (YouTube channel ID -> Nebula channel).
- content.api.nebula.app and rss.nebula.app: public video lists and search for the matched creator. The YouTube video title is sent to search.
- www.floatplane.com/api/v3/...: creator list and post search for the matched creator (YouTube video title as the search term), with the user's existing floatplane.com cookies.
- josh345rtfvqw.github.io/detour/data/known.json (and data/nebula/<slug>.json, data/floatplane/<id>.json catalogues for the creator being watched): the extension's own list of known YouTube -> Nebula/Floatplane matches, video catalogues and Floatplane creators (GitHub Pages, CORS-readable, so no host permission). Data only, never code; every URL in it is validated. No user data is sent; when a video is in the list, nothing is sent to Nebula/Floatplane for it.
Nothing is sent anywhere else, and nothing is sent for creators who aren't on Nebula or Floatplane.

PERMISSIONS
- storage: settings, cached creator/video lists, dismissed banners.
- declarativeNetRequestWithHostAccess: one session rule that sets User-Agent to "<browser UA> Detour/<version> (+repo URL)" on the extension's own requests (tabIds: [-1]) to floatplane.com / nebula.app / nebula.tv, as Floatplane asks API clients to identify themselves. In Firefox, fetch() also sets it directly. User browsing is not modified.
- Host permissions: youtube.com (content script UI), and the Nebula / Floatplane hosts above.

SECURITY NOTES
- Only https links to nebula.tv / nebula.app / floatplane.com are ever inserted into YouTube or navigated to (safeUrl() in background.js); anything else from an API response is dropped.
- All UI is built with DOM APIs and textContent; no innerHTML with remote data.
- page.js runs in YouTube's MAIN world only to read the player's video details (title, channel ID), and talks to the content script via window.postMessage with a nonce.

DATA COLLECTION
data_collection_permissions declares browsingActivity and websiteContent (required), because the video title and matched-creator requests go to Nebula/Floatplane to provide the core feature.
```

---

## 4. Images

| Asset | AMO requirement | File |
|---|---|---|
| Icon | 128×128 (64×64 also accepted) | `icons/icon128.png` |
| Screenshots | Any size; 1280×800 recommended, up to 10 | `store/assets/screenshot-1-video.png` … `screenshot-5-settings.png` |

These are the same five screenshots as for Chrome. Suggested captions, which AMO shows under each one:
1. "Watch on Nebula" appears right next to the video title.
2. Subscribers can be redirected automatically, with a countdown.
3. Channel pages link to the creator on Nebula or Floatplane.
4. Works with Nebula and Floatplane, in light and dark themes.
5. Tick your subscriptions and choose redirects or just a button.

AMO has no promo tiles.

---

## 5. Version notes (for v0.4.0)

```
• Known-videos list: thousands of YouTube videos already matched to their Nebula and Floatplane versions, updated daily, so most matches are instant and need no requests to Nebula or Floatplane
• Full video catalogues for Nebula and Floatplane creators, downloaded only for the creators you watch, so older videos match too
• All 20 Floatplane creators matched to their YouTube channels
• Confirmed matches are remembered for 30 days
• Simpler settings: title matching is now automatic
```

---

## Before submitting

- [ ] Create or sign in to your Firefox account on addons.mozilla.org/developers and accept the developer agreement. There's no fee.
- [x] Minimum version is Firefox **140** (Firefox for Android **142**), so everyone who installs sees the data collection consent prompt.
- [ ] Review usually takes from a few hours to a few days. Because of the youtube.com host permission and the network requests, expect a human to read the code. The reviewer notes above are written for that.
- [ ] After approval, Firefox users get updates automatically when you upload new versions on AMO.
