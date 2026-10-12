const MOD_BONUS = Object.freeze({ F: 0.05, R: 0.05, M: 0.20, N: 0.08 });
const MOD_LABELS = Object.freeze({ F: 'Fly', R: 'Ride', M: 'Mega', N: 'Neon' });

function normalizeMods(input) {
  const requested = Array.isArray(input) ? input : [];
  const mods = [...new Set(requested.filter((mod) => Object.prototype.hasOwnProperty.call(MOD_BONUS, mod)))];

  // Mega and Neon are competing tiers and the catalog has no cell for a pet
  // that is both, so one has to lose. Unlike Fly and Ride, neither tier is
  // implied by the other, so this drops the loser and nothing else.
  //
  // Fly and Ride are NOT bundled in. They used to be pulled in automatically
  // with any tier, which meant (M) could never exist on its own. That was a
  // lookup artefact, not a pricing one: the grid has carried mega.base,
  // mega.fly, mega.ride and mega.flyRide for every pet all along, and
  // variantCellFor simply never went looking for the first three.
  if (mods.includes('M')) return mods.filter((mod) => mod !== 'N');
  if (mods.includes('N')) return mods.filter((mod) => mod !== 'M');
  return mods;
}

function baseValueOf(item) {
  const value = Number(item?.baseValue);
  return Number.isFinite(value) && value >= 0 ? value : Number(item?.value || 0);
}

function moddedValue(baseValue, mods) {
  const base = Number(baseValue || 0);
  if (!Number.isFinite(base) || base < 0) return 0;
  const multiplier = normalizeMods(mods).reduce((total, mod) => total + MOD_BONUS[mod], 1);
  return Math.round(base * multiplier);
}

function modPercent(mods) {
  return Math.round((normalizeMods(mods).reduce((total, mod) => total + MOD_BONUS[mod], 0)) * 100);
}

/**
 * Which stored cell a mod combination corresponds to.
 *
 * The grid is three tiers (normal, mega, neon) by four states (base, fly, ride,
 * flyRide), and every pet carries all twelve. The tier is whichever of Mega or
 * Neon is present, and the state is whichever of Fly/Ride are present, so this
 * resolves all twelve instead of treating every tier as fly + ride.
 *
 * The values are not monotonic in the obvious direction - on most pets Fly and
 * Ride make the pet worth LESS, so mega.base is typically a bigger figure than
 * mega.flyRide. That is the shape of the source data and is left alone rather
 * than smoothed over.
 */
function variantCellFor(mods) {
  const set = new Set(normalizeMods(mods));
  const tier = set.has('M') ? 'mega' : set.has('N') ? 'neon' : 'normal';
  if (set.has('F') && set.has('R')) return [tier, 'flyRide'];
  if (set.has('F')) return [tier, 'fly'];
  if (set.has('R')) return [tier, 'ride'];
  return [tier, 'base'];
}

/**
 * The real value for a mod combination when the catalog carries a per-pet
 * variant grid, otherwise the flat percentage estimate.
 *
 * The grid matters because the ratios are not constant: fly and ride usually
 * make a pet worth LESS, and a mega ranges from roughly 1.5x to 7x depending on
 * the pet, so no single percentage reproduces it.
 */
function valueForMods(item, mods) {
  if (item) {
    const [tier, key] = variantCellFor(mods);
    const real = Number(item?.variants?.[tier]?.[key]);
    if (Number.isFinite(real) && real > 0) return real;
  }
  return moddedValue(baseValueOf(item), mods);
}

/** True when the figure came from the grid rather than the estimate. */
function hasRealVariant(item, mods) {
  const [tier, key] = variantCellFor(mods);
  const real = Number(item?.variants?.[tier]?.[key]);
  return Number.isFinite(real) && real > 0;
}

module.exports = {
  MOD_BONUS, MOD_LABELS, normalizeMods, baseValueOf, moddedValue, modPercent,
  variantCellFor, valueForMods, hasRealVariant
};
