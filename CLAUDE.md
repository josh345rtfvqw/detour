# Detour: notes for Claude

## Platforms are equals

Nebula, Floatplane, ClockwiseTV, 2nd try, WatcherTV and Beacon are equal platforms, and any platform added later joins them on
the same terms. Whenever a platform is added or changed, give it the full treatment the others have:

- **Settings:** its own subscription row in the popup (`options.html` / `options.js`), with a mark,
  colour and switch like Nebula's, and a `<platform>Subscribed` setting (or a per-creator list, like
  Floatplane's) in `DEFAULTS` in `background.js` and `options.js`.
- **Matching:** results carry `subscribed` from that setting and follow the same rules: subscribed
  first, channel-only matches never redirect, and "Show other platforms too" decides whether
  unsubscribed platforms are shown. A platform with no web player only ever returns channel matches.
- **Banner:** the same wording as the others. Subscribed: "Open on <Platform>" to the creator there.
  Not subscribed: "About <Platform>", to the platform's homepage (`HOMES` in `content.js`).
- **Look:** a `.detour-<platform>` colour set in `content.css`, and a one-letter mark in `content.js`.
- **Data:** creators in Detour's master list (`data/known.json`, built by `scripts/build-known.js`),
  keyed by YouTube channel ID, with any hand-edited input listed in the builder's header comment and
  in the update workflow's `paths`. Links it builds pass `safeUrl()` (add its host to `ALLOWED_HOSTS`).
- **Words:** name it alongside the others everywhere they're listed: README, `index.html`,
  `PRIVACY.md`, the store listings in `store/`, the manifest's name and description, release notes,
  and the "not affiliated with" lines.
- **Tests and images:** unit tests in `test/background.test.js` (and `test/build-known.test.js` for
  list changes), e2e checks in `test/e2e.js`, and regenerated store images
  (`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node store/assets/make-store-images.js`).
