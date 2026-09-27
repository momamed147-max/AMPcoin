export const MOD_BONUS = Object.freeze({ F: 0.05, R: 0.05, M: 0.20, N: 0.08 });
export const MOD_LABELS = Object.freeze({ F: 'Fly', R: 'Ride', M: 'Mega', N: 'Neon' });

export function normalizeMods(input) {
  const requested = Array.isArray(input) ? input : [];
  let mods = [...new Set(requested.filter((mod) => Object.prototype.hasOwnProperty.call(MOD_BONUS, mod)))];

  if (mods.includes('M')) mods = mods.filter((mod) => mod !== 'N');
  else if (mods.includes('N')) mods = mods.filter((mod) => mod !== 'M');
  if (mods.includes('M') || mods.includes('N')) {
    mods = [...new Set([...mods.filter((mod) => mod === 'M' || mod === 'N'), 'F', 'R'])];
  }
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
 * normalizeMods turns ['M'] into ['M','F','R'], so a tier always implies fly
 * and ride. The grid is keyed the same way, so mega means mega + fly + ride.
 */
export function variantCellFor(mods) {
  const set = new Set(normalizeMods(mods));
  if (set.has('M')) return ['mega', 'flyRide'];
  if (set.has('N')) return ['neon', 'flyRide'];
  if (set.has('F') && set.has('R')) return ['normal', 'flyRide'];
  if (set.has('F')) return ['normal', 'fly'];
  if (set.has('R')) return ['normal', 'ride'];
  return ['normal', 'base'];
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
