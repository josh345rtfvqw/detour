# Detour privacy policy

Detour has no server. It doesn't collect analytics, and it doesn't send anything to its developer.

## What Detour sends, and to whom

To find a YouTube video on Nebula or Floatplane, Detour sends requests directly from your browser to those services:

- **Nebula** (`talent.nebula.tv`, `content.api.nebula.app`, `rss.nebula.app`):
  - It loads Nebula's public list of creators.
  - When you're on a YouTube video or channel by a creator who is on Nebula, it loads that creator's Nebula video list.
  - If the video isn't in that list, it sends the **YouTube video's title** to Nebula's search.
  - These requests carry no Nebula login or cookies.
- **Floatplane** (`www.floatplane.com`):
  - It loads Floatplane's list of creators.
  - When you're on a YouTube video by a creator who is on Floatplane, it searches that creator's posts using the **YouTube video's title**.
  - These requests use your existing floatplane.com login cookies, so Floatplane can show you its full creator list. Detour never reads, stores or sends your Floatplane credentials anywhere else.

Detour sends nothing about videos or channels that aren't by a creator on Nebula or Floatplane.

This is why the Firefox listing declares **browsing activity** and **website content**: these services can see which of their creators' YouTube videos and channels you open, and the titles of those videos.

## What Detour stores

Detour stores the following in your browser's extension storage:
- **Your settings**, including which subscriptions you've ticked. These sync through your browser account if you use browser sync.
- **A cache of the creator and video lists**, so it doesn't fetch them on every page.
- **The channels whose banner you've dismissed.**

Detour doesn't keep any history of the videos you watch. "Refresh data" in the settings clears the cache.

## Contact

Questions or issues: https://github.com/josh345rtfvqw/detour/issues
