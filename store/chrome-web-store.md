# Chrome Web Store listing

Copy each field into the Chrome Web Store Developer Dashboard. Character limits are noted where the store has them.

---

## Store listing tab

### Name (max 75)

```
Detour
```

Keeping other companies' names out of the extension name avoids trademark problems in review. The platforms are named in the summary and description, which is allowed.

### Summary (max 132)

The dashboard takes this from the manifest's `description` field ("Summary from package"), so it's already set in the package. It can't be edited in the dashboard.

```
See when a YouTube video is also on Nebula or Floatplane, and open it there, automatically if you subscribe.
```

(108 characters)

### Description

```
Detour shows when a YouTube video or channel is also on Nebula or Floatplane, and links to it there.

ON A VIDEO
A "Watch on Nebula" or "Watch on Floatplane" button appears next to the video's title. If you subscribe to that platform, Detour can take you there automatically, with a 3-second countdown and a "Stay on YouTube" option. Or you can choose to just show the button.

ON A CHANNEL
A banner under the Subscribe button lets you know the creator is also on Nebula or Floatplane, with a link to their channel there. Dismiss it once and it stays hidden for that channel.

SETTINGS
• Tick the subscriptions you have: Nebula, and the Floatplane creators you subscribe to
• Choose between automatic redirects and a button
• Open the other site in a new tab instead of leaving YouTube
• Pick which platform wins when a video is on both
• Light and dark themes follow YouTube and your system

HOW IT WORKS
Detour matches the YouTube channel to the creator's Nebula or Floatplane channel, then compares video titles and release dates to find the same video. If the exact video can't be found, you get a link to the creator's channel instead, and Detour doesn't redirect.

PRIVACY
Detour sends requests to Nebula and Floatplane only for creators who are on those services. It doesn't collect usage data, and your Floatplane login stays with floatplane.com. Details are in the privacy policy.

SOURCE CODE
https://github.com/josh345rtfvqw/detour

Detour is an independent project and is not affiliated with or endorsed by YouTube, Google, Nebula or Floatplane. All trademarks belong to their owners.
```

### Category

**Tools** is the closest fit for a utility that works on top of other sites. **Entertainment** also works if you'd rather be listed with video-related extensions.

### Language

English

### Graphic assets

| Asset | Required | Size | File |
|---|---|---|---|
| Store icon | Yes | 128×128 PNG (96×96 artwork + 16 px transparent padding, per Google's guidelines) | `store/assets/chrome-store-icon-128.png` |
| Screenshots | At least 1, up to 5 | 1280×800 | `store/assets/screenshot-1-video.png` … `screenshot-5-settings.png` |
| Small promo tile | Optional (needed for featuring) | 440×280 | `store/assets/promo-small-440x280.png` |
| Marquee promo tile | Optional | 1400×560 | `store/assets/promo-marquee-1400x560.png` |
| Promo video | Optional | YouTube link | `store/assets/promo-video.mp4` (1920×1080, 34 s, silent). Upload it to YouTube, then paste the link |

Upload the screenshots in this order:
1. **Watch it where you already subscribe:** the "Watch on Nebula" chip next to the video title.
2. **Or go there automatically:** the redirect countdown.
3. **Find creators' channels too:** the channel-page banner.
4. **Nebula and Floatplane:** the Floatplane chip, in light theme.
5. **You decide how it works:** the settings popup.

The images show the real extension running on a generic mock video site. They avoid YouTube's branding, and the creators are made up. To regenerate them after UI changes, run:

```bash
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node store/assets/make-store-images.js
```

### Promo video

The store takes a YouTube link, not a file. Upload `store/assets/promo-video.mp4` to YouTube (Unlisted is fine), then paste the video's link into **Store listing → Global promo video**.

Suggested YouTube title and description:

```
Detour: watch YouTube videos on Nebula and Floatplane
```

```
Detour is a free browser extension. When a YouTube video is also on Nebula or Floatplane, it shows a "Watch on Nebula" or "Watch on Floatplane" button, or takes you there automatically if you subscribe.

Chrome Web Store: https://chromewebstore.google.com/detail/detour/lofobnkomhhicgcpejnlcibekkaiaeed
Source code: https://github.com/josh345rtfvqw/detour

The video shows the real extension on a mock video site with made-up creators. Detour is an independent project and is not affiliated with or endorsed by YouTube, Google, Nebula or Floatplane.
```

The video is silent. To regenerate it after UI changes (about 3 minutes):

```bash
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node store/assets/make-promo-video.js
```

### Additional fields

- **Official URL / Homepage:** `https://josh345rtfvqw.github.io/detour/`
- **Support URL:** `https://josh345rtfvqw.github.io/detour/SUPPORT.html`
- **Mature content:** No

---

## Privacy practices tab

### Single purpose (required)

```
Detour helps people who subscribe to Nebula or Floatplane watch YouTube videos on those platforms instead. On YouTube video and channel pages it checks whether the creator and video are also on Nebula or Floatplane, then shows a link or, if the user has turned it on and subscribes, redirects them there.
```

### Permission justifications

**storage**
```
Saves the user's settings (which subscriptions they have, redirect or button mode, new-tab preference, preferred platform), a cache of Nebula and Floatplane creator and video lists so they aren't re-downloaded on every page, and the channels whose banner the user dismissed.
```

**declarativeNetRequestWithHostAccess**
```
Sets a User-Agent header that identifies the extension and its version ("Detour/<version>") on the extension's own requests to Floatplane and Nebula, as Floatplane asks API clients to do. Chrome ignores a User-Agent set in fetch(), so a session rule is used. The rule only matches requests made by the extension itself (tabId -1) to floatplane.com, nebula.app and nebula.tv, so the user's own browsing of those sites is never modified. No other requests are blocked, redirected or changed.
```

**Host permission: youtube.com**
```
The extension's content script runs on YouTube video and channel pages to read the video title and channel, and to show the "Watch on Nebula/Floatplane" button, the channel banner, and the optional redirect countdown.
```

**Host permissions: content.api.nebula.app, rss.nebula.app, talent.nebula.tv**
```
talent.nebula.tv/creators is Nebula's public list of creators with their YouTube channels, used to work out whether a YouTube channel is on Nebula. content.api.nebula.app (Nebula's public video API) and rss.nebula.app (Nebula's public RSS feeds, used as a fallback) are used to find the matching video on that creator's Nebula channel. No Nebula account data is accessed.
```

**Host permission: www.floatplane.com**
```
Used to load Floatplane's list of creators (with their YouTube channels) and to search a matched creator's posts for the same video. The requests use the user's existing floatplane.com session so the full creator list is available. The extension never reads, stores or transmits Floatplane credentials.
```

### Remote code

```
No, I am not using remote code.
```

All JavaScript ships inside the extension package. The extension only downloads data (JSON, HTML and RSS), never code to execute. That includes its own list of known videos from `https://josh345rtfvqw.github.io/detour/data/known.json`: plain JSON, with every link in it validated.

### Data usage

**What user data do you plan to collect from users now or in the future?** Tick:

- [x] **Web history.** When the user is on a YouTube video by a creator who is on Nebula or Floatplane, the video's title is sent to that platform's search. Requests for that creator's video list also show which creators' videos the user opens.
- [x] **Website content.** The YouTube video title above is page content.

Leave everything else unticked:
- Personally identifiable information
- Health information
- Financial and payment information
- Authentication information. The browser attaches the user's own floatplane.com cookies to requests to floatplane.com, but the extension never reads, stores or sends them anywhere else.
- Personal communications
- Location
- User activity. No clicks, keystrokes or mouse movement are recorded.

These are also declared for Firefox as `browsingActivity` and `websiteContent`.

**Certify all three:**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

The "approved use case" here is sending the video title and creator requests to Nebula and Floatplane. That's necessary for the single purpose and is disclosed in the privacy policy.

### Privacy policy URL

```
https://josh345rtfvqw.github.io/detour/PRIVACY.html
```

---

## Test instructions tab

- **Username / Password:** leave blank. No account is needed, and don't share your own Floatplane login.
- **Additional instructions (max 500):**

```
No account needed. 1) Click the Detour toolbar icon, turn on "Nebula", choose "Show a button". 2) Open a recent YouTube video by a Nebula creator, e.g. Real Engineering, Wendover Productions or Half as Interesting: a "Watch on Nebula" button appears beside the title. 3) Open that creator's channel: a banner appears under Subscribe. 4) Choose "Redirect me" and open another of their videos: a 3s countdown, then Nebula opens. Floatplane works the same when logged in.
```

## Distribution tab

- **Visibility:** Public, or Unlisted if you want to share it with a link first.
- **Regions:** All regions.
- **Pricing:** Free.

## Before submitting

- [ ] Pay the one-time $5 developer registration fee, if you haven't already.
- [ ] Upload the release zip (`detour-<version>.zip` from GitHub Releases).
- [ ] Upload the five screenshots and the promo tiles from `store/assets/`.
- [ ] Optional: upload `store/assets/promo-video.mp4` to YouTube and paste its link as the promo video.
- [ ] Enable GitHub Pages (Settings → Pages → Deploy from a branch → `main`, `/ (root)`), then check that the homepage, privacy and support URLs open in a private window.
- [ ] Expect review to take a few days. Host permissions on youtube.com can mean a closer manual review.
