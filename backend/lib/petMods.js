const MOD_BONUS = Object.freeze({ F: 0.05, R: 0.05, M: 0.20, N: 0.08 });
const MOD_LABELS = Object.freeze({ F: 'Fly', R: 'Ride', M: 'Mega', N: 'Neon' });

function normalizeMods(input) {
  const requested = Array.isArray(input) ? input : [];
  let mods = [...new Set(requested.filter((mod) => Object.prototype.hasOwnProperty.call(MOD_BONUS, mod)))];

  // Mega and Neon are mutually exclusive bundles and each includes Fly + Ride.
  if (mods.includes('M')) mods = mods.filter((mod) => mod !== 'N');
  else if (mods.includes('N')) mods = mods.filter((mod) => mod !== 'M');
  if (mods.includes('M') || mods.includes('N')) {
    mods = [...new Set([...mods.filter((mod) => mod === 'M' || mod === 'N'), 'F', 'R'])];
  }
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

module.exports = { MOD_BONUS, MOD_LABELS, normalizeMods, baseValueOf, moddedValue, modPercent };
