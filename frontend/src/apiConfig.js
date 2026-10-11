const configuredApiUrl = String(
  process.env.REACT_APP_API_URL || ''
).trim();

/**
 * The API base is baked into the bundle at BUILD time, not read at runtime.
 *
 * That makes a missing REACT_APP_API_URL dangerous rather than merely wrong:
 * the build still succeeds, ships, and every request goes to a localhost that
 * does not exist on the player's machine. The site looks deployed and is
 * completely dead, with no error anywhere except an empty page.
 *
 * The check for that lives in the deploy workflow, which fails the build step
 * outright. An earlier attempt threw from this module instead - but CRA only
 * evaluates it inside a lazy chunk, so the throw happened in the player's
 * browser rather than in CI, which is the exact opposite of what was wanted.
 *
 * What remains here is a warning, so a build that is somehow wrong with the
 * right variable is still diagnosable from the console.
 */
export const API_BASE = (configuredApiUrl || 'http://localhost:5000').replace(/\/+$/, '');

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !configuredApiUrl) {
  console.error(
    '[apiConfig] REACT_APP_API_URL was not set at build time, so every request ' +
    'will go to http://localhost:5000 and the site will not work. ' +
    'The deploy workflow is supposed to prevent this - check that it still does.'
  );
} else if (isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(API_BASE)) {
  console.warn(
    `[apiConfig] Production build is pointing at ${API_BASE}. ` +
    'If that is not intentional, REACT_APP_API_URL is set incorrectly.'
  );
}

export default API_BASE;
