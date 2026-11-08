# Detour

*Watch YouTube videos on Nebula & Floatplane instead.*

A Chrome/Firefox extension. On a YouTube video page it checks whether the same video
is on **Nebula** or **Floatplane**. Then it either:

- **redirects automatically**, if you've said you subscribe there (3-second countdown with a "Stay on YouTube" option), or
- **shows a "Watch on Nebula / Floatplane" badge** in the corner of the player. It shrinks to a small icon while the video plays and expands again on hover.

On **channel pages** it shows a banner above the tabs when the channel is on Nebula or Floatplane.
You can dismiss the banner for each channel. Colours follow the platform and YouTube's light or dark theme.

You pick which in the settings. If the video itself can't be matched, but the channel is on
the platform, you get a link to the channel instead. Channel-only matches never auto-redirect.

## Install

**Chrome / Edge / Brave**
1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

**Firefox (128+)**
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
| Nebula | Nebula's creator wall ([talent.nebula.tv/creators](https://talent.nebula.tv/creators/)) | Nebula's public content API (newest 100 videos, then search); falls back to Nebula's [RSS feeds](https://blog.nebula.tv/rss-feed/) | No |
| Floatplane | The YouTube links each Floatplane creator/channel lists | Floatplane's post search | Your own floatplane.com login (browser cookies) |

Videos are matched by title similarity, with a boost when release dates are within about a week.
Auto-redirect only happens above the confidence threshold set in the settings (default 0.75).
Each video redirects at most once per tab, so pressing Back keeps you on YouTube.

## Privacy

Detour has no server and collects no analytics. To find matches, it sends requests directly to Nebula and Floatplane.
For creators who are on those platforms, that includes the YouTube video's title.
Details are in [PRIVACY.md](PRIVACY.md).

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
git tag v0.2.0
```

```bash
git push origin v0.2.0
```

The Release workflow checks that the tag matches the manifest, runs the tests,
and publishes a GitHub release with the zip attached.

The first test runs the lookup logic against mocked APIs. The second loads the extension
in Playwright's Chromium against mocked YouTube and Nebula pages.

## Limits

- Nebula and Floatplane APIs are unofficial and can change without notice.
- Videos renamed between platforms, or very old videos, may only get a channel link.
