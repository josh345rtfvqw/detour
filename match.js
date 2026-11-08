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

if (typeof module !== 'undefined') module.exports = { normalizeTitle, titleSimilarity, scoreCandidate, bestMatch, normalizeName };
