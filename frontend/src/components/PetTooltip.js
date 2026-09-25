import React from 'react';
import ModBadges from './ModBadges';
import Icon from './Icon';
import './ModBadges.css';

/* Pet hover tooltip: dark card with image, badges, name, value. */
const PetTooltip = ({ item }) => {
  const name = item.name || item.itemName || 'Item';
  const rarity = (item.rarity || 'common').toLowerCase();
  const unitVal = Number(item.value || 0);
  const qty = parseInt(item.quantity || 1, 10) || 1;
  const itemMods = Array.isArray(item.mods) ? item.mods : [];
  const showF = itemMods.includes('F') || itemMods.includes('M') || itemMods.includes('N');
  const showR = itemMods.includes('R') || itemMods.includes('M') || itemMods.includes('N');
  return (
    <div className="pet-tip">
      <div className="pet-tip-img-wrap">
        <img
          src={item.image || item.imageUrl || '/default-item.png'}
          alt={name}
          className="pet-tip-img"
          onError={(e) => { e.target.src = '/default-item.png'; }}
        />
        {showF && <span className="pet-tip-badge badge-f">F</span>}
        {showR && <span className="pet-tip-badge badge-r">R</span>}
      </div>
      <div className="pet-tip-name">{name}{qty > 1 ? ` ×${qty}` : ''}</div>
      <ModBadges mods={item.mods} size={16} />
      <div className="pet-tip-val"><span className="cf-diamond-sm"><Icon name="diamond" size={11} /></span> {(unitVal * qty).toLocaleString()}</div>
      <div className={`pet-tip-rarity rarity-${rarity}`}>{rarity.replace('_', ' ')}</div>
    </div>
  );
};

export default PetTooltip;
