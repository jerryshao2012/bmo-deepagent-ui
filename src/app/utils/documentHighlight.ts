/**
 * Citation highlight utilities.
 *
 * When a user clicks a citation link in an AI response, we derive a `quote`
 * string from the sentence surrounding the link and use it to highlight the
 * matching passage in the opened document (PDF / DOCX / PPTX / XLSX).
 *
 * This module is framework-agnostic and side-effect free except for the DOM
 * helpers (`highlightTextInElement` / `clearHighlights`) which mutate a given
 * root element.
 */

export interface CharRange {
  start: number;
  end: number;
}

interface NormalizedResult {
  normText: string;
  normToRaw: number[];
}

function buildNormalized(raw: string): NormalizedResult {
  let normText = "";
  const normToRaw: number[] = [];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i].toLowerCase();
    const isAlphanumeric =
      (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");

    if (isAlphanumeric) {
      normText += ch;
      normToRaw.push(i);
    } else {
      if (normText.length > 0 && !normText.endsWith(" ")) {
        normText += " ";
        normToRaw.push(i);
      }
    }
  }

  if (normText.endsWith(" ")) {
    normText = normText.slice(0, -1);
    normToRaw.pop();
  }

  return { normText, normToRaw };
}

/** Lowercase + collapse all non-alphanumeric runs into single spaces. */
export function normalizeForMatch(text: string): string {
  if (!text) return "";
  return buildNormalized(text).normText;
}

/** Split normalized text into non-empty word tokens. */
export function tokenize(text: string): string[] {
  const norm = normalizeForMatch(text);
  if (!norm) return [];
  return norm.split(" ").filter((t) => t.length > 0);
}

/**
 * Find the best character range in `haystack` matching `quote`.
 *
 * Strategy (first hit wins):
 *  1. Exact normalized substring.
 *  2. Token-overlap sliding window (window size clamped to [4, 40]); returns
 *     the highest-scoring window above the 0.4 overlap threshold.
 *  3. Any 4-word or 3-word n-gram of the quote as an exact normalized substring.
 *  4. null (no match).
 */
export function findBestRange(
  haystackText: string,
  quote: string
): CharRange | null {
  if (!haystackText || !quote) return null;

  const { normText: normHaystack, normToRaw } = buildNormalized(haystackText);
  const normQuote = normalizeForMatch(quote);
  if (!normHaystack || !normQuote) return null;

  const toRawRange = (nStart: number, nEnd: number): CharRange => {
    const rawStart = normToRaw[nStart] ?? 0;
    const rawEnd =
      nEnd > 0 && nEnd - 1 < normToRaw.length
        ? normToRaw[nEnd - 1] + 1
        : haystackText.length;
    return { start: rawStart, end: Math.max(rawStart + 1, rawEnd) };
  };

  // 1. Exact normalized substring.
  const exact = normHaystack.indexOf(normQuote);
  if (exact !== -1) {
    return toRawRange(exact, exact + normQuote.length);
  }

  const quoteTokens = normQuote.split(" ").filter(Boolean);
  const haystackTokens = normHaystack.split(" ").filter(Boolean);
  if (quoteTokens.length === 0 || haystackTokens.length === 0) return null;

  // 2. Token-overlap sliding window.
  const windowSize = Math.max(4, Math.min(40, quoteTokens.length));
  let bestScore = 0;
  let bestWinStart = -1;

  for (let i = 0; i + windowSize <= haystackTokens.length; i++) {
    let overlap = 0;
    const quoteFreq = new Map<string, number>();
    for (const t of quoteTokens) {
      quoteFreq.set(t, (quoteFreq.get(t) || 0) + 1);
    }

    for (let j = i; j < i + windowSize; j++) {
      const t = haystackTokens[j];
      const count = quoteFreq.get(t);
      if (count && count > 0) {
        overlap++;
        quoteFreq.set(t, count - 1);
      }
    }
    const score = overlap / windowSize;
    if (score > 2 / windowSize) { // Must match at least 2 tokens
      if (score > bestScore) {
        bestScore = score;
        bestWinStart = i;
      }
    }
  }

  if (bestWinStart !== -1 && bestScore >= 0.4) {
    const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "as", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did"]);
    const quoteKeywords = quoteTokens.filter(t => !stopWords.has(t));
    const leadingKeywords = Array.from(new Set(quoteKeywords)).slice(0, 4);

    // Find the first token in the window that matches one of the leading keywords to align the start precisely
    let firstLeadIdx = -1;
    for (let j = bestWinStart; j < bestWinStart + windowSize; j++) {
      const ht = haystackTokens[j];
      const matchesLead = leadingKeywords.some(lk => ht === lk || (ht.length >= 4 && lk.startsWith(ht)) || (lk.length >= 4 && ht.startsWith(lk)));
      if (matchesLead) {
        firstLeadIdx = j;
        break;
      }
    }

    const finalStart = firstLeadIdx !== -1 ? firstLeadIdx : bestWinStart;

    // Find the last matching token in the window
    let lastMatchIdx = -1;
    for (let j = bestWinStart + windowSize - 1; j >= bestWinStart; j--) {
      const ht = haystackTokens[j];
      if (quoteTokens.includes(ht)) {
        lastMatchIdx = j;
        break;
      }
    }
    const finalEndBase = lastMatchIdx !== -1 ? lastMatchIdx + 1 : bestWinStart + windowSize;

    // Expand the end to the right to include any nearby matching keywords of the quote
    let finalEnd = finalEndBase;
    let lastKeywordMatch = finalEndBase - 1;
    for (let j = finalEndBase; j < Math.min(haystackTokens.length, finalEndBase + 60); j++) {
      const ht = haystackTokens[j];
      const matchesKeyword = quoteKeywords.some(kw => ht === kw || (ht.length >= 4 && kw.startsWith(ht)) || (kw.length >= 4 && ht.startsWith(kw)));
      if (matchesKeyword) {
        if (j - lastKeywordMatch <= 8) {
          finalEnd = j + 1;
          lastKeywordMatch = j;
        }
      }
    }

    const charStart = tokenCharOffset(normHaystack, finalStart);
    const charEnd = tokenCharEndOffset(normHaystack, finalEnd);

    // Expand the end of the range to the nearest sentence boundary (first . or ! or ? followed by space, or end of text)
    const rawStart = normToRaw[charStart] ?? 0;
    let rawEnd = charEnd > 0 && charEnd - 1 < normToRaw.length ? normToRaw[charEnd - 1] + 1 : haystackText.length;

    const restText = haystackText.slice(rawEnd);
    const sentenceEndMatch = restText.match(/^[^.!?]*[.!?](?=\s|$)/);
    if (sentenceEndMatch) {
      rawEnd += sentenceEndMatch[0].length;
    }

    return { start: rawStart, end: Math.max(rawStart + 1, rawEnd) };
  }

  // 3. 4-word and 3-word n-grams of the quote (for heavily paraphrased text).
  for (const n of [4, 3]) {
    for (let i = 0; i + n <= quoteTokens.length; i++) {
      const gram = quoteTokens.slice(i, i + n).join(" ");
      const idx = normHaystack.indexOf(gram);
      if (idx !== -1) {
        return toRawRange(idx, idx + gram.length);
      }
    }
  }

  // 3b. Short quotes: fall back to 2- or 1-word n-gram only if quote is very short.
  if (quoteTokens.length <= 4) {
    for (let i = 0; i + 2 <= quoteTokens.length; i++) {
      const gram = quoteTokens.slice(i, i + 2).join(" ");
      const idx = normHaystack.indexOf(gram);
      if (idx !== -1) {
        return toRawRange(idx, idx + gram.length);
      }
    }
    const single = normHaystack.indexOf(quoteTokens[0]);
    if (single !== -1) {
      return toRawRange(single, single + quoteTokens[0].length);
    }
  }

  return null;
}


function tokenCharOffset(normalized: string, tokenIndex: number): number {
  if (tokenIndex <= 0) return 0;
  let seen = 0;
  let i = 0;
  while (i < normalized.length && seen < tokenIndex) {
    const sp = normalized.indexOf(" ", i);
    if (sp === -1) return normalized.length;
    i = sp + 1;
    seen++;
  }
  return i;
}

function tokenCharEndOffset(normalized: string, tokenEndIndex: number): number {
  if (tokenEndIndex <= 0) return 0;
  let seen = 0;
  let i = 0;
  while (i < normalized.length && seen < tokenEndIndex) {
    const sp = normalized.indexOf(" ", i);
    if (sp === -1) return normalized.length;
    i = sp + 1;
    seen++;
  }
  return i > 0 && normalized[i - 1] === " " ? i - 1 : i;
}

// ---------------------------------------------------------------------------
// DOM highlight helpers (DOCX / PPTX / XLSX — all HTML-based viewers)
// ---------------------------------------------------------------------------

const MARK_CLASS = "cite-highlight";

/** Remove any previously-inserted highlight <mark> nodes under `root`. */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll(`mark.${MARK_CLASS}`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    // Replace the mark with its children, then merge adjacent text nodes.
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * Highlight the best match for `quote` inside `root` by wrapping matched text
 * runs in `<mark class="cite-highlight">`. Returns the number of `<mark>`
 * nodes created (0 if no match).
 *
 * Safe to call repeatedly; call `clearHighlights` first for idempotency.
 */
export function highlightTextInElement(
  root: HTMLElement,
  quote: string,
  markClass: string = MARK_CLASS
): number {
  if (!quote) return 0;

  // Collect all text nodes under root (excluding <script>/<style>).
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue && node.nodeValue.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  interface Segment {
    node: Text;
    start: number; // offset within the flat string
    len: number;
  }
  const segments: Segment[] = [];
  let flat = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const textNode = n as Text;
    const val = textNode.nodeValue ?? "";
    segments.push({ node: textNode, start: flat.length, len: val.length });
    flat += val;
  }

  const range = findBestRange(flat, quote);
  if (!range) return 0;

  // Wrap each text-node segment (or part of it) that falls within [range].
  let created = 0;
  for (const seg of segments) {
    const segEnd = seg.start + seg.len;
    if (segEnd <= range.start || seg.start >= range.end) continue; // no overlap

    const localStart = Math.max(0, range.start - seg.start);
    const localEnd = Math.min(seg.len, range.end - seg.start);
    if (localEnd <= localStart) continue;

    let targetNode = seg.node;
    // Split off the tail we don't want to wrap (right boundary).
    if (localEnd < seg.len) {
      targetNode = targetNode.splitText(localEnd);
    }
    // Split off the head we don't want to wrap (left boundary).
    if (localStart > 0) {
      targetNode = targetNode.splitText(localStart);
    }

    const mark = document.createElement("mark");
    mark.className = markClass;
    targetNode.parentNode?.insertBefore(mark, targetNode);
    mark.appendChild(targetNode);
    created++;
  }

  return created;
}
