import React from 'react';
import './ModBadges.css';

const MOD_COLORS = {
  F: '#1f6feb', // Fly — blue
  R: '#f08800', // Ride — orange
  M: '#ff44cc', // Mega — pink
  N: '#ffcc00'  // Neon — yellow
};

const MOD_TITLES = {
  F: 'Fly (+5%)',
  R: 'Ride (+5%)',
  M: 'Mega Forged (+30%)',
  N: 'Neon Forged (+18%)'
};

/**
 * Little circle badges for pet modifiers.
 * Mega and Neon each display their effective F/R expansion badge set.
 * Usage: <ModBadges mods={item.mods} />
 */
const expandMods = (mods) => {
  const out = [];
  const push = (m) => { if (!out.includes(m)) out.push(m); };
  const clean = Array.isArray(mods) ? mods : [];
  if (clean.includes('M')) { push('M'); push('F'); push('R'); }
  if (clean.includes('N')) { push('N'); push('F'); push('R'); }
  clean.forEach((m) => { if (MOD_COLORS[m]) push(m); });
  return out;
};

const ModBadges = ({ mods, size = 18 }) => {
  const clean = expandMods(mods);
  if (clean.length === 0) return null;
  return (
    <span className="mod-badges" style={{ '--mod-size': `${size}px` }}>
      {clean.map((m) => (
        <span
          key={m}
          className={`mod-badge-circle mod-${m}`}
          style={{ background: MOD_COLORS[m] }}
          title={MOD_TITLES[m]}
        >
          {m}
        </span>
      ))}
    </span>
  );
};

export default ModBadges;
