export const MOD_BONUS = Object.freeze({ F: 0.05, R: 0.05, M: 0.20, N: 0.08 });
export const MOD_LABELS = Object.freeze({ F: 'Fly', R: 'Ride', M: 'Mega', N: 'Neon' });

export function normalizeMods(input) {
  const requested = Array.isArray(input) ? input : [];
  const mods = [...new Set(requested.filter((mod) => Object.prototype.hasOwnProperty.call(MOD_BONUS, mod)))];

  // Mega and Neon compete - there is no cell for a pet that is both - so one
  // loses. Fly and Ride are independent and are never bundled in here. This
  // mirrors backend/lib/petMods.js exactly; if the two drift, the admin panel
  // previews a different value from the one the server actually grants.
  if (mods.includes('M')) return mods.filter((mod) => mod !== 'N');
  if (mods.includes('N')) return mods.filter((mod) => mod !== 'M');
  return mods;
}

export function baseValueOf(item) {
  const value = Number(item?.baseValue);
  return Number.isFinite(value) && value >= 0 ? value : Number(item?.value || 0);
}

export function moddedValue(baseValue, mods) {
  const base = Number(baseValue || 0);
  if (!Number.isFinite(base) || base < 0) return 0;
  const multiplier = normalizeMods(mods).reduce((total, mod) => total + MOD_BONUS[mod], 1);
  return Math.round(base * multiplier);
}

export function modPercent(mods) {
  return Math.round(normalizeMods(mods).reduce((total, mod) => total + MOD_BONUS[mod], 0) * 100);
}

/**
 * Which stored cell a mod combination corresponds to.
 *
 * Mirrors backend/lib/petMods.js. The grid is three tiers (normal, mega, neon)
 * by four states (base, fly, ride, flyRide) and every pet carries all twelve,
 * so the tier comes from Mega/Neon and the state from Fly/Ride.
 */
export function variantCellFor(mods) {
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
 * The grid matters: fly and ride are usually worth LESS than the base value,
 * and a mega can range from about 1.5x to 7x depending on the pet, so no
 * single percentage reproduces it.
 */
export function valueForMods(item, mods) {
  if (item) {
    const [tier, key] = variantCellFor(mods);
    const real = Number(item?.variants?.[tier]?.[key]);
    if (Number.isFinite(real) && real > 0) return real;
  }
  return moddedValue(baseValueOf(item), mods);
}

/** True when the figure came from the grid rather than the estimate. */
export function hasRealVariant(item, mods) {
  const [tier, key] = variantCellFor(mods);
  const real = Number(item?.variants?.[tier]?.[key]);
  return Number.isFinite(real) && real > 0;
}
