// Title matching shared by the background script.
// Titles often differ slightly between platforms (punctuation, "| Nebula Exclusive",
// A/B-tested YouTube titles), so we score token overlap instead of requiring equality.

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'and', 'or', 'as', 'of', 'be', 'to', 'in', 'on', 'for', 'with']);
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')            // accents
    .replace(/["'’‘“”()[\]{}]/g, '')
    .replace(/\b(nebula|floatplane)\s+(exclusive|original|early access)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return normalizeTitle(s)
    .split(/[\s\-_.,?!:;|/&+–—#]+/)
    .filter(t => t && !STOPWORDS.has(t))
    .map(t => (/^\d+$/.test(t) && NUMBERS[+t]) || t);
}

// Cosine similarity of token-count vectors, 0..1. Exact normalized match = 1.
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  if (normalizeTitle(a) === normalizeTitle(b)) return 1;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const ca = new Map(), cb = new Map();
  ta.forEach(t => ca.set(t, (ca.get(t) || 0) + 1));
  tb.forEach(t => cb.set(t, (cb.get(t) || 0) + 1));
  let dot = 0;
  for (const [t, n] of ca) dot += n * (cb.get(t) || 0);
  const norm = m => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return dot / (norm(ca) * norm(cb));
}

// Score a candidate: title similarity, nudged up if release dates are close.
// (Floatplane/Nebula often publish a few days before YouTube.)
function scoreCandidate(ytTitle, ytDate, candTitle, candDate) {
  let score = titleSimilarity(ytTitle, candTitle);
  if (ytDate && candDate && score >= 0.4) {
    const days = Math.abs(new Date(ytDate) - new Date(candDate)) / 86400000;
    if (days <= 8) score = Math.min(1, score + 0.2);
  }
  return score;
}

// Pick the best candidate; reject if the runner-up is nearly as good (ambiguous).
function bestMatch(ytTitle, ytDate, candidates) {
  const scored = candidates
    .map(c => ({ ...c, confidence: scoreCandidate(ytTitle, ytDate, c.title, c.date) }))
    .sort((x, y) => y.confidence - x.confidence);
  if (!scored.length) return null;
  const [best, second] = scored;
  if (best.confidence < 1 && second && best.confidence - second.confidence < 0.05) {
    best.confidence = Math.min(best.confidence, 0.5); // ambiguous: never auto-redirect
  }
  return best;
}

function normalizeName(s) {
  return normalizeTitle(s).replace(/[^a-z0-9]/g, '');
}

// ---- Nebula creator wall (talent.nebula.tv/creators) ----
// Shared by the extension and scripts/build-known.js. Each creator card carries the YouTube
// channel ID (data-video), the creator's name (image alt text) and a link to their Nebula channel.
const SLUG = /^[\w-]{1,100}$/;
const decodeHtml = s => (s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

function parseCreatorWall(html) {
  const creators = [];
  for (const block of html.split(/class="[^"]*\byoutube-creator\b/).slice(1)) {
    const ytId = (block.match(/data-video="(UC[\w-]{22})"/) || [])[1];
    const name = decodeHtml((block.match(/alt="([^"]*)"/) || [])[1]).trim();
    // Prefer the explicit Nebula link; fall back to the card title's link (talent.nebula.tv/<slug>/).
    const nebula = (block.match(/href="https?:\/\/(?:www\.)?nebula\.(?:tv|app)\/([\w-]+)\/?"/) || [])[1];
    const titleHref = (block.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"/) || [])[1];
    let alt = null;
    if (titleHref) {
      try { alt = new URL(titleHref, 'https://talent.nebula.tv/').pathname.split('/').filter(Boolean)[0] || null; } catch { /* ignore */ }
    }
    if (alt && !SLUG.test(alt)) alt = null;
    const slug = nebula || alt;
    if (slug && (ytId || name) && !creators.some(c => c.slug === slug)) creators.push({ name, slug, alt: alt !== slug ? alt : null, ytId: ytId || null });
  }
  return creators;
}

if (typeof module !== 'undefined') module.exports = { normalizeTitle, tokens, titleSimilarity, scoreCandidate, bestMatch, normalizeName, decodeHtml, parseCreatorWall, SLUG };
