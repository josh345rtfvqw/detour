# Detour privacy policy

**Effective date:** 8 November 2026

Detour is a browser extension that shows when a YouTube video or channel is also on Nebula or Floatplane, and can take you there. This policy explains what data Detour handles, where it goes, and what it stores.

**In short:**
- Detour has no server and collects no analytics.
- Its developer never receives any of your data.
- Detour talks only to Nebula and Floatplane, directly from your browser, and only to provide its feature.

## Data Detour sends, and to whom

To find a YouTube video on Nebula or Floatplane, Detour sends requests directly from your browser to those services. Nothing is sent through any server run by the developer.

### Nebula

Domains: `talent.nebula.tv`, `content.api.nebula.app`, `rss.nebula.app`

- **Creator list.** Detour loads Nebula's public list of creators and their YouTube channels. The request contains nothing about you.
- **A creator's videos.** When you open a YouTube video by a creator who is on Nebula, Detour loads that creator's public Nebula video list. This reveals to Nebula which of its creators' videos you opened.
- **Video search.** If the video isn't in that list, Detour sends the **YouTube video's title** to Nebula's public search.

These requests carry no Nebula login or cookies.

### Floatplane

Domain: `www.floatplane.com`

- **Creator list.** Detour loads Floatplane's list of creators and their YouTube channels.
- **Post search.** When you open a YouTube video by a creator who is on Floatplane, Detour searches that creator's Floatplane posts using the **YouTube video's title**.

Your browser attaches your existing floatplane.com login cookies to these requests, so Floatplane can return its full creator list. Detour never reads, stores or transmits your Floatplane credentials.

### What isn't sent

- Nothing about videos or channels whose creator isn't on Nebula or Floatplane.
- No browsing history, account details, identifiers, clicks or keystrokes.

Requests to Nebula and Floatplane identify the extension in the User-Agent header as `Detour/<version>` with a link to this project, as Floatplane asks API clients to do. That header contains no information about you.

How Nebula and Floatplane handle the requests they receive is covered by their own privacy policies.

## Data Detour stores

Detour stores the following in your browser's extension storage:
- **Your settings**, including which subscriptions you've ticked and how Detour should behave. If you use Chrome sync or Firefox Sync, your browser syncs these settings to your account.
- **A cache of the Nebula and Floatplane creator and video lists**, so they aren't downloaded on every page. Video lists for at most 60 channels are kept. Older ones are deleted automatically.
- **The channels whose banner you've dismissed.**

Detour keeps no history of the videos or pages you visit.

You can clear the cache at any time with **Refresh data** in Detour's settings. Removing the extension deletes all of its stored data.

## Limited Use

Detour's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements:
- Data is used only to provide Detour's single purpose: finding and opening the matching video or channel on Nebula or Floatplane.
- Data is sent only to Nebula and Floatplane, and only for that purpose.
- Data is not sold, used for advertising, or used to determine creditworthiness.
- No person reads it. The developer never receives it.

## Children

Detour isn't directed at children and doesn't knowingly collect data from anyone.

## Changes

If this policy changes, the new version will be published at this address with a new effective date. Changes are also tracked in the project's [Git history](https://github.com/josh345rtfvqw/detour/commits/main/PRIVACY.md).

## Contact

Questions or concerns: https://github.com/josh345rtfvqw/detour/issues
