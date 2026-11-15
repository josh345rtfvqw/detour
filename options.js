const DEFAULTS = {
  autoRedirect: true, newTab: false,
  showButton: true, nebulaSubscribed: false, floatplaneCreators: [],
};
const $ = id => document.getElementById(id);
let settings;

async function save(patch) {
  Object.assign(settings, patch);
  await chrome.storage.sync.set(patch);
  render();
}


// Things that depend on more than one setting.
function render() {
  $('nebulaRow').classList.toggle('active', settings.nebulaSubscribed);
  const n = settings.floatplaneCreators.length;
  $('fpCount').textContent = n ? `${n} selected` : '';
  $('fpRow').classList.toggle('active', n > 0);
  $('newTab').disabled = !settings.autoRedirect;
  $('newTabRow').style.opacity = settings.autoRedirect ? '' : '.55';
  $('modeHint').textContent = settings.autoRedirect
    ? 'A 3-second countdown lets you stay on YouTube instead.'
    : 'A “Watch on …” button appears next to Like and Share.';
}

function bindSwitch(id) {
  const input = $(id);
  input.checked = settings[id];
  input.addEventListener('change', () => save({ [id]: input.checked }));
}

function bindRadios(name, toValue, fromValue) {
  document.querySelectorAll(`input[name=${name}]`).forEach(r => {
    r.checked = r.value === fromValue(settings);
    r.addEventListener('change', () => r.checked && save(toValue(r.value)));
  });
}

const isSelected = c => settings.floatplaneCreators.includes(c.id) || settings.floatplaneCreators.includes(fpNameKey(c.title));

function renderCreators(creators) {
  const list = $('fpList');
  list.textContent = '';
  if (!creators.length) {
    list.innerHTML = '<div class="empty">No creators found.</div>';
    return;
  }
  creators.sort((a, b) => a.title.localeCompare(b.title));
  // Selected creators first so they're easy to find.
  creators.sort((a, b) => isSelected(b) - isSelected(a));
  for (const c of creators) {
    const row = document.createElement('label');
    row.className = 'creator';
    row.dataset.name = c.title.toLowerCase();
    const img = c.icon ? Object.assign(document.createElement('img'), { src: c.icon, alt: '', loading: 'lazy' })
      : Object.assign(document.createElement('span'), { className: 'ph' });
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: c.title });
    const cb = Object.assign(document.createElement('input'), {
      type: 'checkbox', className: 'switch floatplane', checked: isSelected(c),
    });
    cb.setAttribute('role', 'switch');
    cb.setAttribute('aria-label', `I subscribe to ${c.title}`);
    cb.addEventListener('change', () => {
      const set = new Set(settings.floatplaneCreators);
      set.delete(fpNameKey(c.title)); // drop any by-name entry; store the ID from now on
      cb.checked ? set.add(c.id) : set.delete(c.id);
      save({ floatplaneCreators: [...set] });
    });
    row.append(img, name, cb);
    list.append(row);
  }
  applyFilter();
}

function applyFilter() {
  const q = $('fpFilter').value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('#fpList .creator').forEach(r => {
    const match = r.dataset.name.includes(q);
    r.hidden = !match;
    shown += match;
  });
  let none = $('fpNone');
  if (!shown && document.querySelector('#fpList .creator')) {
    if (!none) {
      none = Object.assign(document.createElement('div'), { id: 'fpNone', className: 'empty' });
      $('fpList').append(none);
    }
    none.textContent = `No creators match “${q}”.`;
  } else none?.remove();
}

async function loadCreators() {
  let creators = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'fpCreators' });
    if (resp && !resp.error) creators = resp.creators;
    else console.warn('[detour] creator list:', resp?.error);
  } catch (e) { console.warn('[detour] creator list:', e); }
  creators ||= [];
  renderCreators(creators);
  if (!creators.length) {
    const note = document.createElement('div');
    note.className = 'empty';
    note.innerHTML = 'Couldn’t load the creator list. Check your connection, or <a href="https://www.floatplane.com" target="_blank" rel="noopener">log in to Floatplane</a>.';
    $('fpList').append(note);
  } else if (creators.every(c => c.builtin)) {
    // Only the master list's creators: say so, and how to get the full live list.
    const note = document.createElement('div');
    note.className = 'empty';
    note.innerHTML = 'Showing known creators. <a href="https://www.floatplane.com" target="_blank" rel="noopener">Log in to Floatplane</a> to see everyone.';
    $('fpList').append(note);
  }
}

$('fpFilter').addEventListener('input', applyFilter);

// The Floatplane creator list opens from its row, so it starts the same height as Nebula's.
$('fpRow').addEventListener('click', () => {
  const open = $('fpRow').getAttribute('aria-expanded') !== 'true';
  $('fpRow').setAttribute('aria-expanded', String(open));
  $('fpSub').hidden = !open;
  if (open) $('fpFilter').focus();
});

// The button shows its own progress: Refresh → Refreshing… → Done → Refresh.
$('clearCache').addEventListener('click', async () => {
  const btn = $('clearCache');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    await chrome.runtime.sendMessage({ type: 'clearCache' });
    await loadCreators();
    btn.textContent = 'Done';
  } catch (e) {
    console.warn('[detour] refresh failed', e);
    btn.textContent = 'Try again';
  }
  setTimeout(() => { btn.textContent = 'Refresh'; btn.disabled = false; }, 1500);
});

(async () => {
  settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  bindSwitch('nebulaSubscribed');
  bindSwitch('newTab');
  bindSwitch('showButton');
  bindRadios('mode', v => ({ autoRedirect: v === 'redirect' }), s => (s.autoRedirect ? 'redirect' : 'button'));
  render();
  loadCreators();
})();
