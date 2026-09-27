/* Chat content filter and escalating mute ladder.

   Plain use of a listed word is only filtered. Anything that only matches
   after de-obfuscating (leet substitutions, split-up letters, small typos)
   counts as a bypass attempt and mutes the sender on the ladder below. */

const BLOCKED_CHAT_TERMS = [
  'tip', 'tips',
  'slide', 'slides', 'slid', 'sliding',
  'buy', 'buys', 'buying', 'bought',
  'sell', 'sells', 'selling', 'sold'
];
// "tipped" and "tipping" are deliberately absent - they are ordinary English
// ("the tipping point") and the exact-match rule would flag them constantly.

// Escalating mute ladder. Index 0 is the first offence; past the end is
// permanent.
const MUTE_LADDER_MS = [
  10 * 60 * 1000,          // 1st: 10 minutes
  30 * 60 * 1000,          // 2nd: 30 minutes
  3 * 60 * 60 * 1000,      // 3rd: 3 hours
  24 * 60 * 60 * 1000,     // 4th: 1 day
  7 * 24 * 60 * 60 * 1000  // 5th: 1 week
  // 6th and beyond: permanent
];

const LEET_MAP = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b',
  '@': 'a', $: 's', '!': 'i', '+': 't', '(': 'c', '|': 'l'
};

function deLeet(token) {
  return token.replace(/[0134578@$!+|()]/g, (c) => LEET_MAP[c] || c);
}

// Levenshtein distance, with a cheap length guard.
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 99;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[b.length];
}

function formatMuteDuration(ms) {
  if (ms >= 24 * 60 * 60 * 1000) {
    const days = Math.round(ms / (24 * 60 * 60 * 1000));
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (ms >= 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))} hours`;
  return `${Math.max(1, Math.round(ms / 60000))} minutes`;
}

/**
 * Inspect a message for blocked words.
 * -> { plain: [...] }  straightforward use, message is filtered only
 * -> { bypass: [...] } obfuscated attempt, sender is muted
 */
function scanChatMessage(raw) {
  const lower = String(raw).toLowerCase();
  const tokens = lower.match(/[a-z0-9@$!+|()]+/g) || [];
  const clean = tokens.map(deLeet);

  const plain = [];
  const bypass = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = clean[i];
    const obfuscated = tokens[i] !== token; // e.g. "t1p" -> "tip"

    if (BLOCKED_CHAT_TERMS.includes(token)) {
      // Landing on a blocked word via leet substitution is deliberate.
      if (obfuscated) bypass.push(token);
      else plain.push(token);
      continue;
    }

    // A single-character slip away from a blocked word ("slid", "sels").
    // Two guards keep this from firing on ordinary words: one edit only
    // (two edits matched "guide" -> "slide"), and a 4-character floor, since
    // at 3 characters "top" is one edit from "tip" and "net" from "sell".
    if (token.length >= 4 && BLOCKED_CHAT_TERMS.some((t) => editDistance(token, t) <= 1)) {
      bypass.push(token);
    }
  }

  // Deliberate letter-splitting: "b u y i n g" or "s.ell" rebuilds a word that
  // no single token contains. Short runs only, so real sentences are untouched.
  for (let i = 0; i < clean.length; i++) {
    let joined = '';
    for (let j = i; j < clean.length && j - i < 8; j++) {
      if (clean[j].length > 4) break;
      joined += clean[j];
      // j > i means at least two tokens were glued together - a single short
      // token is not a "join", it is just the word.
      if (j > i && joined.length >= 3 && BLOCKED_CHAT_TERMS.includes(joined)) {
        bypass.push(joined);
        i = j;
        break;
      }
    }
  }

  return { plain, bypass };
}

/**
 * Apply the next rung of the ladder. Offences persist on the user so the
 * escalation keeps climbing across separate incidents.
 */
function applyProgressiveMute(user, terms) {
  const offences = (Number(user.chatOffenses) || 0) + 1;
  const duration = MUTE_LADDER_MS[offences - 1];

  user.chatOffenses = offences;
  user.isMuted = true;
  user.mutedAt = new Date().toISOString();
  user.mutedBy = 'chat_filter';
  user.muteReason = `Blocked word in chat (${terms.join(', ')})`;
  user.mutedUntil = duration ? new Date(Date.now() + duration).toISOString() : null;
  user.updatedAt = new Date().toISOString();

  return {
    offences,
    permanent: !duration,
    duration: duration || null,
    until: user.mutedUntil
  };
}

/** A timed mute lapses on its own; the offence count is kept. */
function clearExpiredMute(user) {
  if (user.isMuted !== true) return false;
  if (!user.mutedUntil) return false; // permanent
  if (Date.now() < new Date(user.mutedUntil).getTime()) return false;
  user.isMuted = false;
  user.mutedUntil = null;
  user.mutedBy = null;
  user.muteReason = null;
  user.updatedAt = new Date().toISOString();
  return true;
}

module.exports = {
  BLOCKED_CHAT_TERMS,
  MUTE_LADDER_MS,
  deLeet,
  editDistance,
  formatMuteDuration,
  scanChatMessage,
  applyProgressiveMute,
  clearExpiredMute
};
