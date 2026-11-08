const DEFAULTS = {
  autoRedirect: true, newTab: false, minConfidence: 0.75, preferred: 'nebula',
  showButton: true, nebulaSubscribed: false, floatplaneCreators: [],
};
const $ = id => document.getElementById(id);
let settings;

async function save(patch) {
  Object.assign(settings, patch);
  await chrome.storage.sync.set(patch);
}

function bind(id) {
  const input = $(id);
  if (input.type === 'checkbox') {
    input.checked = settings[id];
    input.addEventListener('change', () => save({ [id]: input.checked }));
  } else {
    input.value = settings[id];
    input.addEventListener('change', () => save({ [id]: input.type === 'number' ? Number(input.value) : input.value }));
  }
}

function renderCreators(creators) {
  const list = $('fpList');
  list.textContent = '';
  if (!creators.length) { list.innerHTML = '<div class="status">No creators found.</div>'; return; }
  creators.sort((a, b) => a.title.localeCompare(b.title));
  for (const c of creators) {
    const row = document.createElement('label');
    row.className = 'row';
    row.dataset.name = c.title.toLowerCase();
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: settings.floatplaneCreators.includes(c.id) });
    cb.addEventListener('change', () => {
      const set = new Set(settings.floatplaneCreators);
      cb.checked ? set.add(c.id) : set.delete(c.id);
      save({ floatplaneCreators: [...set] });
    });
    row.append(cb);
    if (c.icon) row.append(Object.assign(document.createElement('img'), { src: c.icon, alt: '' }));
    row.append(c.title);
    list.append(row);
  }
}

async function loadCreators() {
  const resp = await chrome.runtime.sendMessage({ type: 'fpCreators' });
  if (resp?.error) {
    $('fpList').innerHTML = '<div class="status">Couldn’t load Floatplane creators. Log in at <a href="https://www.floatplane.com" target="_blank">floatplane.com</a>, then reopen this page.</div>';
    return;
  }
  renderCreators(resp.creators);
}

$('fpFilter').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#fpList label').forEach(r => { r.style.display = r.dataset.name.includes(q) ? '' : 'none'; });
});

$('clearCache').addEventListener('click', async () => {
  $('cacheStatus').textContent = 'Refreshing…';
  await chrome.runtime.sendMessage({ type: 'clearCache' });
  await loadCreators();
  $('cacheStatus').textContent = 'Done.';
});

(async () => {
  settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  ['nebulaSubscribed', 'newTab', 'showButton', 'preferred', 'minConfidence'].forEach(bind);
  document.querySelectorAll('input[name=mode]').forEach(r => {
    r.checked = (r.value === 'redirect') === settings.autoRedirect;
    r.addEventListener('change', () => save({ autoRedirect: r.value === 'redirect' }));
  });
  loadCreators();
})();
