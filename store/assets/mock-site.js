// The generic mock video site used for store images and the promo video: no YouTube branding,
// made-up creators, mocked Nebula / Floatplane responses. The real extension runs against it.
const NEB_ID = 'UCexampleengineering0001';
const FP_ID = 'UCexamplelabs00000000001';

// ------------------------------------------------------------------ mock pages

const ytChrome = (dark) => `
<div style="height:56px;display:flex;align-items:center;gap:16px;padding:0 24px">
  <div style="display:flex;align-items:center;gap:8px;width:220px">
    <div style="width:30px;height:22px;border-radius:6px;background:${dark ? '#3d3d3d' : '#d6d6d6'}"></div>
    <span style="font-weight:700;font-size:17px;letter-spacing:-.02em">VideoSite</span>
  </div>
  <div style="flex:1;display:flex;justify-content:center"><div style="width:520px;height:38px;border-radius:19px;border:1px solid ${dark ? '#333' : '#d3d3d3'};background:${dark ? '#121212' : '#f8f8f8'}"></div></div>
  <div style="width:220px;display:flex;justify-content:flex-end"><div style="width:32px;height:32px;border-radius:50%;background:${dark ? '#555' : '#c4c4c4'}"></div></div>
</div>`;

const btn = (dark, label, primary) => `<button style="height:36px;padding:0 16px;border-radius:18px;border:0;font:500 14px Inter,sans-serif;${primary
  ? (dark ? 'background:#f1f1f1;color:#0f0f0f' : 'background:#0f0f0f;color:#fff')
  : (dark ? 'background:#272727;color:#f1f1f1' : 'background:#f2f2f2;color:#0f0f0f')}">${label}</button>`;

function videoPage({ vid, title, chId, author, subs, dark, hue }) {
  const fg = dark ? '#f1f1f1' : '#0f0f0f', muted = dark ? '#aaa' : '#606060', card = dark ? '#272727' : '#f2f2f2';
  const upNext = ['The Hidden Engineering of Tunnels', 'How Cranes Build Themselves', 'Concrete Is Weirder Than You Think', 'Why Skyscrapers Sway', 'The Bridge That Danced']
    .map(t => `<div style="display:flex;gap:8px"><div style="width:168px;height:94px;border-radius:8px;background:${card};flex-shrink:0"></div><div style="display:flex;flex-direction:column;gap:4px"><span style="font-weight:600;font-size:14px;line-height:1.3">${t}</span><span style="font-size:12px;color:${muted}">${author}</span></div></div>`).join('');
  return `<!doctype html><html ${dark ? 'dark' : ''}><head><meta charset="utf-8"></head>
<body style="margin:0;background:${dark ? '#0f0f0f' : '#fff'};color:${fg};font-family:Inter,sans-serif">
${ytChrome(dark)}
<div style="display:flex;gap:24px;padding:12px 24px 0">
  <div style="width:820px">
    <div id="movie_player" style="width:820px;height:461px;border-radius:12px;background:linear-gradient(135deg,hsl(${hue},45%,22%),hsl(${hue + 40},55%,12%));display:flex;align-items:center;justify-content:center;position:relative">
      <video style="display:none"></video>
      <svg width="76" height="76" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.45)"/><path d="M10 7.5l6 4.5-6 4.5z" fill="#fff"/></svg>
    </div>
    <ytd-watch-metadata style="display:block">
      <div id="title"><h1 style="margin:14px 0 10px;font-size:20px;font-weight:700;line-height:1.3">${title}</h1></div>
      <div id="top-row" style="display:flex;justify-content:space-between;align-items:center">
        <div id="owner" style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:hsl(${hue},35%,45%)"></div>
          <div style="display:flex;flex-direction:column"><span style="font-weight:600">${author}</span><span style="font-size:12px;color:${muted}">${subs} subscribers</span></div>
          ${btn(dark, 'Subscribe', true)}
        </div>
        <div id="actions"><div id="actions-inner" style="display:flex;gap:8px">${btn(dark, 'Like')}${btn(dark, 'Share')}${btn(dark, 'Save')}</div></div>
      </div>
      <div style="margin-top:14px;padding:12px;border-radius:12px;background:${card};font-size:14px;line-height:1.5"><b>248K views · 3 days ago</b><br><span style="color:${dark ? '#d0d0d0' : '#333'}">A closer look at how it really works.</span></div>
    </ytd-watch-metadata>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:10px">${upNext}</div>
</div>
<script>
const p = document.getElementById('movie_player');
p.getPlayerResponse = () => ({ videoDetails: { videoId: '${vid}', title: ${JSON.stringify(title)}, channelId: '${chId}', author: ${JSON.stringify(author)} },
  microformat: { playerMicroformatRenderer: { ownerProfileUrl: '', publishDate: '2026-11-05' } } });
p.pauseVideo = () => {};
</script></body></html>`;
}

function channelPage({ chId, author, handle, dark, hue }) {
  const muted = dark ? '#aaa' : '#606060', card = dark ? '#272727' : '#f2f2f2';
  const vids = ['Why Bridges Don’t Collapse', 'The Hidden Engineering of Tunnels', 'Concrete Is Weirder Than You Think', 'How Dams Hold Back a Lake']
    .map(t => `<div style="display:flex;flex-direction:column;gap:8px"><div style="aspect-ratio:16/9;border-radius:10px;background:${card}"></div><span style="font-weight:600;font-size:14px">${t}</span><span style="font-size:12px;color:${muted}">1.1M views · 3 weeks ago</span></div>`).join('');
  return `<!doctype html><html ${dark ? 'dark' : ''}><head><meta charset="utf-8"></head>
<body style="margin:0;background:${dark ? '#0f0f0f' : '#fff'};color:${dark ? '#f1f1f1' : '#0f0f0f'};font-family:Inter,sans-serif">
${ytChrome(dark)}
<div style="padding:8px 48px 0;display:flex;flex-direction:column;gap:18px">
  <div style="height:150px;border-radius:16px;background:linear-gradient(120deg,hsl(${hue},40%,${dark ? 22 : 80}%),hsl(${hue + 50},50%,${dark ? 14 : 70}%))"></div>
  <div id="page-header"><yt-page-header-view-model style="display:flex;gap:24px;align-items:flex-start">
    <div style="width:140px;height:140px;border-radius:50%;background:hsl(${hue},35%,45%);flex-shrink:0"></div>
    <div style="display:flex;flex-direction:column;gap:6px;flex:1">
      <span style="font-size:34px;font-weight:700;letter-spacing:-.02em">${author}</span>
      <span style="font-size:14px;color:${muted}">@${handle} · 1.2M subscribers · 310 videos</span>
      <span style="font-size:14px;color:${muted}">How the built world works, one structure at a time.</span>
      <yt-flexible-actions-view-model style="display:block;margin-top:8px">${btn(dark, 'Subscribe', true)}</yt-flexible-actions-view-model>
    </div>
  </yt-page-header-view-model></div>
  <div id="tabs-container" style="display:flex;gap:28px;border-bottom:1px solid ${dark ? '#303030' : '#e5e5e5'};font-weight:600;font-size:15px">
    <span style="padding:10px 0;color:${muted}">Home</span><span style="padding:10px 0;box-shadow:inset 0 -2px 0 currentColor">Videos</span><span style="padding:10px 0;color:${muted}">Shorts</span><span style="padding:10px 0;color:${muted}">Playlists</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">${vids}</div>
</div>
<script>window.ytInitialData = { metadata: { channelMetadataRenderer: { title: ${JSON.stringify(author)}, externalId: '${chId}', vanityChannelUrl: 'http://www.youtube.com/@${handle}' } } };</script>
</body></html>`;
}

const CREATOR_WALL = `<div id="creator-wall"><div class="youtube-creator" data-video="${NEB_ID}"><img alt="Example Engineering"><h3><a href="https://talent.nebula.tv/exampleengineering/">Example Engineering</a></h3><a class="link nebula" href="https://nebula.tv/exampleengineering">Nebula</a></div></div>`;


// Serve the mock site and mocked platform APIs to a Playwright context.
async function installMockSite(ctx) {
  const json = (route, b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
  const html = (route, b) => route.fulfill({ contentType: 'text/html', body: b });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('chrome-extension://') || u.startsWith('data:')) return route.continue();
    if (u.includes('youtube.com/watch?v=NEB1')) return html(route, videoPage({ vid: 'NEB1', title: 'Why Bridges Don’t Collapse (Most of the Time)', chId: NEB_ID, author: 'Example Engineering', subs: '1.2M', dark: true, hue: 230 }));
    if (u.includes('youtube.com/watch?v=NEB2')) return html(route, videoPage({ vid: 'NEB2', title: 'The Hidden Engineering of Tunnels', chId: NEB_ID, author: 'Example Engineering', subs: '1.2M', dark: true, hue: 200 }));
    if (u.includes('youtube.com/watch?v=FP1')) return html(route, videoPage({ vid: 'FP1', title: 'I Built the Quietest PC Possible', chId: FP_ID, author: 'Example Labs', subs: '860K', dark: false, hue: 190 }));
    if (u.includes('youtube.com/@ExampleEngineering')) return html(route, channelPage({ chId: NEB_ID, author: 'Example Engineering', handle: 'ExampleEngineering', dark: true, hue: 235 }));
    if (u.includes('talent.nebula.tv/creators')) return html(route, CREATOR_WALL);
    if (u.includes('/content/exampleengineering/')) return json(route, { id: 'c1' });
    if (u.includes('video_channels/c1/video_episodes')) return json(route, { results: [
      { title: 'Why Bridges Don’t Collapse (Most of the Time)', published_at: '2026-11-04', share_url: 'https://nebula.tv/videos/exampleengineering-bridges' },
      { title: 'The Hidden Engineering of Tunnels', published_at: '2026-10-20', share_url: 'https://nebula.tv/videos/exampleengineering-tunnels' }] });
    if (u.includes('floatplane.com/api/v3/creator/list')) return json(route, [
      { id: 'exlabs', title: 'Example Labs', urlname: 'examplelabs', socialLinks: { youtube: `https://www.youtube.com/channel/${FP_ID}` }, channels: [] }]);
    if (u.includes('floatplane.com/api/v3/content/creator')) return json(route, [{ id: 'p1', title: 'I Built the Quietest PC Possible', releaseDate: '2026-11-03' }]);
    if (u.includes('nebula.tv/videos/')) return html(route, '<body style="background:#0d0d14"></body>');
    return route.fulfill({ status: 404, body: '' });
  });
}

module.exports = { NEB_ID, FP_ID, videoPage, channelPage, CREATOR_WALL, installMockSite };
