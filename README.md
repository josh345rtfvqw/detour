# Detour

*Watch YouTube videos on Nebula & Floatplane instead.*

A Chrome/Firefox extension. On a YouTube video page it checks whether the same video
is on **Nebula** or **Floatplane**. Then it either:

- **redirects automatically**, if you've said you subscribe there (3-second countdown with a "Stay on YouTube" option), or
- **shows a "Watch on Nebula / Floatplane" button** next to the video title.

On **channel pages** it shows a banner under the Subscribe button when the channel is on Nebula or Floatplane.
You can dismiss the banner for each channel. Colours follow the platform and YouTube's light or dark theme.

You pick which in the settings. If the video itself can't be matched, but the channel is on
the platform, you get a link to the channel instead. Channel-only matches never auto-redirect.

## Install

**Chrome / Edge / Brave:** install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/detour/lofobnkomhhicgcpejnlcibekkaiaeed).

To run from source instead:
1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

**Firefox (140+)**
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json`. Temporary add-ons are removed
   when Firefox restarts. For a permanent install, sign the add-on through addons.mozilla.org.
3. If YouTube shows nothing, open the add-on's permissions in `about:addons` and allow all sites it lists.

Then click the extension icon:
- tick **I subscribe to Nebula** if you do;
- tick the **Floatplane creators** you subscribe to. To list them, log in at floatplane.com first;
- choose **Redirect automatically** or **Just show a button**.

## How it finds videos

| | Channel mapping | Video lookup | Login needed? |
|---|---|---|---|
| Nebula | Every channel in Nebula's [channel list](https://nebula.tv/explore/channels), linked to YouTube by the [creator wall](https://talent.nebula.tv/creators/) or a matching YouTube handle | Nebula's public content API (newest 100 videos, then search); falls back to Nebula's [RSS feeds](https://blog.nebula.tv/rss-feed/) | No |
| Floatplane | The YouTube links each Floatplane creator/channel lists | Floatplane's post search | Your own floatplane.com login (browser cookies) |

Requests to Nebula and Floatplane identify the extension. Floatplane asks API clients to do this.
They use the browser's normal User-Agent with `Detour/<version> (+https://github.com/josh345rtfvqw/detour)` added on the end.
In Chrome, a header rule applies it to the extension's own requests only. Your own browsing of those sites isn't changed.

**Known-videos list.** Detour also downloads a master list from this repo's GitHub Pages site, [`data/known.json`](data/known.json), about twice a day. The list can be updated without releasing a new extension version. A [daily GitHub Action](.github/workflows/update-list.yml) builds it, and it's keyed by YouTube, the starting point for every lookup:

```json
{
  "version": 3,
  "counts":   { "videos": 24683, "nebula_videos": …, "nebula_creators": …, "floatplane_creators": …, … },
  "videos":   { "<YouTube video ID>":   { "nebula": "<video slug> or <podcast>/<episode>", "floatplane": "<post id>" } },
  "channels": { "<YouTube channel ID>": { "name": "…", "nebula": "<slug>", "floatplane": "<creator id>/<channel id>" } },
  "nebula":     { "creators": { "<slug>": { "name": "…", "catalog": true } } },
  "floatplane": { "creators": { "<creator id>": { "name": "…", "urlname": "…", "channels": { … }, "catalog": true } } }
}
```

- **`counts`** gives the totals (videos per platform, podcast episodes, creators, YouTube channels) for checking the list at a glance. The extension doesn't use it.
- **`videos` and `channels`** have one column per platform. A column is missing when there's no match. The list holds IDs only, and the extension builds the links.
- **Nebula channels and podcasts** come from Nebula's channel and podcast lists (the ones behind [nebula.tv/explore/channels](https://nebula.tv/explore/channels)). Nebula's [newest-channels feed](https://rss.nebula.app/video/channels.rss) is checked too, so a new channel is picked up even if the list can't be read. Neither list says which YouTube channel a Nebula channel belongs to. The creator wall supplies that for most creators. For the rest, the builder tries the YouTube handle with the same name as the Nebula slug, and only uses it if the YouTube channel's name matches. To link one by hand, add `"channels": { "<nebula slug>": "<YouTube channel link>" }` to [`data/overrides.json`](data/overrides.json).
- **Creator catalogues** hold every video of every Nebula channel (`data/nebula/<slug>.json`), every episode of every Nebula podcast (`data/nebula-podcasts/<slug>.json`), and every video post of every Floatplane creator (`data/floatplane/<id>.json`). The first run pulls each creator's whole history, and the daily run only adds newer videos. The extension downloads a creator's catalogue when you watch them and matches locally, without contacting Nebula or Floatplane.
- **Matching** works the same way for both platforms. Each creator's latest YouTube uploads, from YouTube's public RSS feeds, are matched by title and date against their catalogue. Floatplane's YouTube links (`@handles`, `/user/…`) are resolved to channel IDs once and remembered in [`data/youtube-channels.json`](data/youtube-channels.json).
- **Podcasts** are each linked to its creator's YouTube channel by name. When the name doesn't match, add `"creators": ["<wall slug>"]` or `"youtube": ["<channel link>"]` for that show in [`data/nebula-podcasts.json`](data/nebula-podcasts.json). A YouTube upload that's on Nebula both as a video and as a podcast episode links to the video.
- **Hand-edited inputs:** [`data/floatplane-creators.json`](data/floatplane-creators.json), [`data/nebula-podcasts.json`](data/nebula-podcasts.json) and [`data/overrides.json`](data/overrides.json), which can set or remove (`null`) a platform column for a YouTube video, or link a Nebula channel to YouTube. Saving any of these files on `main` rebuilds the list straight away.

**Anonymous only.** The Action never logs in anywhere and never sends cookies or credentials. If Floatplane refuses its creator list, the Action still fetches each creator's posts using the creator IDs it already knows. If Floatplane refuses those too, Floatplane is skipped for that run and the previous data is kept. Either way, Floatplane matching also works live in each user's browser, with their own session.

Confirmed matches are also remembered in the browser for 30 days, so revisits need no network requests.

Videos are matched by title similarity, with a boost when release dates are within about a week.
Auto-redirect only happens for a confident match: a video in the known-videos list, or a title match of at least 75%.
Each video redirects at most once per tab, so pressing Back keeps you on YouTube.

## Privacy

Detour doesn't collect usage data. To find matches, it sends requests directly to Nebula and Floatplane.
For creators who are on those platforms, that includes the YouTube video's title.
Details are in [PRIVACY.md](PRIVACY.md). For help, see [SUPPORT.md](SUPPORT.md).

## Development

```bash
npm ci
```

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run test:e2e
```

```bash
npm run build
```

`npm test` runs the lookup logic against mocked APIs. `npm run lint` applies Firefox's add-on rules.
`npm run test:e2e` loads the extension in Chromium against mocked YouTube and Nebula pages.
`npm run build` writes `dist/detour-<version>.zip`.

GitHub Actions runs all of these on every push and pull request, and attaches the zip to each run.

## Releasing

Bump `version` in `manifest.json` (and `package.json`) and push to `main`.
Then open **Actions → Release → Run workflow** on GitHub. It tags the commit as `v<version>`,
runs the tests, and publishes a release with the zip attached.

Pushing a tag also works:

```bash
git tag v<version>
```

```bash
git push origin v<version>
```

The Release workflow checks that the tag matches the manifest, runs the tests,
and publishes a GitHub release with the zip attached.

The first test runs the lookup logic against mocked APIs. The second loads the extension
in Playwright's Chromium against mocked YouTube and Nebula pages.

## Limits

- Nebula and Floatplane APIs are unofficial and can change without notice.
- Videos renamed between platforms, or very old videos, may only get a channel link.
