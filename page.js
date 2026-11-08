// Runs in YouTube's own page context so it can read the player's data
// (title, channel ID, publish date), which the isolated content script can't see.
(() => {
  const playerResponse = () => {
    const p = document.getElementById('movie_player');
    const r = p?.getPlayerResponse?.();
    return r || window.ytInitialPlayerResponse;
  };

  window.addEventListener('message', ev => {
    if (ev.source !== window || ev.data?.source !== 'detour-cs') return;
    const { type, videoId, nonce } = ev.data;
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
    } else if (type === 'pause') {
      document.getElementById('movie_player')?.pauseVideo?.();
      document.querySelector('video')?.pause();
    }
  });
})();
