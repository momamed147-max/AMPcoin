/**
 * Who is allowed to see that somebody is an admin.
 *
 * A hidden admin is fully admin - every admin route, every admin permission.
 * The only difference is that the flag is withheld from payloads that are not
 * their own session, so no chat badge, profile card or user list can reveal
 * them. Roblox has had this for years for exactly the same reason: moderation
 * staff who would otherwise be singled out.
 *
 * Suppressing at the source is the whole point. Hiding it in the frontend would
 * still ship `isAdmin: true` to the browser, where it can be read straight out
 * of the network tab or the React tree. Anything the client receives, the
 * player has.
 *
 * Kept in one module rather than pasted into each route: the first version was
 * duplicated into chat.js and users.js and one copy landed inside a function
 * scope, so every profile lookup threw and silently degraded to the error
 * branch.
 */
function revealableAdmin(user, viewerId) {
  if (!user || user.isAdmin !== true) return false;
  if (user.hiddenAdmin !== true) return true;
  // Their own session keeps it - that is what drives the admin panel.
  return viewerId != null && String(user.id) === String(viewerId);
}

/**
 * Whether a viewer may see the outcome-control tab. Deliberately derived, not
 * stored on the user: the operator list lives in an env var on the server and
 * is never persisted, so there is nothing in the database to leak.
 */
function isOutcomeOperatorFor(user) {
  if (!user) return false;
  try {
    // Required lazily so this module stays usable without the env being set.
    // eslint-disable-next-line global-require
    return require('./forcedOutcome').isOperator(user.robloxUsername);
  } catch (_) {
    return false;
  }
}

module.exports = { revealableAdmin, isOutcomeOperatorFor };
