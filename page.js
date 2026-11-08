// Runs in YouTube's own page context so it can read the player's and channel page's data
// (title, channel ID, publish date), which the isolated content script can't see.
(() => {
  const playerResponse = () => {
    const p = document.getElementById('movie_player');
    const r = p?.getPlayerResponse?.();
    return r || window.ytInitialPlayerResponse;
  };

  // Channel metadata for the channel page currently shown, or null if YouTube hasn't
  // swapped its data in yet (it navigates without reloading, so old data can linger).
  function channelInfo(path) {
    const candidates = [
      document.querySelector('ytd-browse[role="main"]')?.data,
      document.querySelector('ytd-browse')?.data,
      window.ytInitialData,
    ];
    const seg = decodeURIComponent(path.split('/').filter(Boolean).slice(0, 2).join('/')).toLowerCase();
    for (const data of candidates) {
      const m = data?.metadata?.channelMetadataRenderer;
      if (!m) continue;
      const vanity = (m.vanityChannelUrl || '').toLowerCase();
      const matches = seg.startsWith('channel/') ? seg === `channel/${(m.externalId || '').toLowerCase()}`
        : vanity.endsWith('/' + seg) || vanity.endsWith('/' + seg.replace(/^(c|user)\//, ''));
      if (matches) return { channelId: m.externalId, author: m.title, profileUrl: m.vanityChannelUrl || '' };
    }
    return null;
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window || ev.data?.source !== 'detour-cs') return;
    const { type, videoId, path, nonce } = ev.data;
    if (type === 'getInfo') {
      const r = playerResponse();
      const d = r?.videoDetails;
      const mf = r?.microformat?.playerMicroformatRenderer;
      const info = d && d.videoId === videoId ? {
        videoId,
        title: d.title,
        channelId: d.channelId,
        author: d.author,
        profileUrl: mf?.ownerProfileUrl || '',
        publishDate: mf?.publishDate || mf?.uploadDate || '',
      } : null;
      window.postMessage({ source: 'detour-page', nonce, info }, '*');
    } else if (type === 'getChannel') {
      window.postMessage({ source: 'detour-page', nonce, info: channelInfo(path) }, '*');
    } else if (type === 'pause') {
      document.getElementById('movie_player')?.pauseVideo?.();
      document.querySelector('video')?.pause();
    }
  });
})();
