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
