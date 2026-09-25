import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import ModBadges from './ModBadges';
import { MOD_LABELS, normalizeMods, baseValueOf, moddedValue } from '../lib/petMods';
import './AdminPetsTab.css';

const RARITIES = ['all', 'common', 'uncommon', 'rare', 'ultra_rare', 'epic', 'legendary', 'mythic'];

function itemImage(item) {
  return item?.imageUrl || item?.image || '/default-item.png';
}

function itemName(item) {
  return item?.name || item?.itemName || 'Unnamed pet';
}

const AdminPetsTab = ({
  items,
  newPet,
  setNewPet,
  onSubmit,
  onToggleNewMod,
  onTogglePetMod,
  onRemovePet,
  modBusyId,
  isOwner,
  purgeBusy,
  purgeArmed,
  onPurge,
  wipeName,
  setWipeName,
  wipeBusy,
  wipeArmed,
  onWipe
}) => {
  const [search, setSearch] = useState('');
  const [rarity, setRarity] = useState('all');
  const [sort, setSort] = useState('name');

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = (items || []).filter((item) => {
      if (rarity !== 'all' && String(item.rarity || 'common').toLowerCase() !== rarity) return false;
      if (!term) return true;
      return [itemName(item), item.description, item.itemName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
    return list.sort((a, b) => {
      if (sort === 'value-high') return Number(b.value || 0) - Number(a.value || 0);
      if (sort === 'value-low') return Number(a.value || 0) - Number(b.value || 0);
      if (sort === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return itemName(a).localeCompare(itemName(b));
    });
  }, [items, rarity, search, sort]);

  const update = (key, value) => setNewPet((current) => ({ ...current, [key]: value }));
  const base = Number(newPet.baseValue !== undefined && newPet.baseValue !== '' ? newPet.baseValue : (newPet.value ?? 0));
  const previewMods = normalizeMods(newPet.mods);
  const previewValue = moddedValue(base, previewMods);

  return (
    <div className="pet-manager">
      <div className="pet-manager-header">
        <div>
          <span className="pet-manager-eyebrow"><Icon name="box" size={13} /> Catalog studio</span>
          <h2>Pet library</h2>
          <p>Create polished pet entries, tune modifiers, and keep the catalog tidy.</p>
        </div>
        <div className="pet-manager-count"><strong>{items?.length || 0}</strong><span>catalog entries</span></div>
      </div>

      <div className="pet-manager-layout">
        <section className="pet-create-card">
          <div className="pet-card-heading">
            <div><span className="pet-card-kicker">New entry</span><h3>Add a pet</h3></div>
            <span className="pet-live-chip"><span /> Live preview</span>
          </div>

          <form className="pet-create-form" onSubmit={onSubmit}>
            <div className="pet-form-grid">
              <div className="pet-field pet-field-wide">
                <label htmlFor="pet-name">Pet name</label>
                <input id="pet-name" value={newPet.name || ''} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Neon Dragon" required />
              </div>
              <div className="pet-field">
                <label htmlFor="pet-rarity">Rarity</label>
                <select id="pet-rarity" value={newPet.rarity || 'common'} onChange={(event) => update('rarity', event.target.value)}>
                  {RARITIES.slice(1).map((option) => <option value={option} key={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}
                </select>
              </div>
              <div className="pet-field">
                <label htmlFor="pet-value">Base value <span>AMP</span></label>
                <input id="pet-value" type="number" min="0" step="any" value={newPet.value ?? ''} onChange={(event) => update('value', event.target.value)} placeholder="0" required />
              </div>
              <div className="pet-field pet-field-wide">
                <label htmlFor="pet-description">Description <span>optional</span></label>
                <input id="pet-description" value={newPet.description || ''} onChange={(event) => update('description', event.target.value)} placeholder="Short description for the catalog" />
              </div>
              <div className="pet-field pet-field-wide">
                <label htmlFor="pet-image">Image URL <span>optional</span></label>
                <input id="pet-image" value={newPet.imageUrl || ''} onChange={(event) => update('imageUrl', event.target.value)} placeholder="https://..." />
              </div>
            </div>

            <div className="pet-mod-section">
              <div className="pet-mod-heading"><div><strong>Modifier bundle</strong><span>Choose one clean preset or stack F/R.</span></div><span className="pet-preview-value">{previewValue.toLocaleString()} AMP</span></div>
              <div className="pet-mod-grid">
                {['F', 'R', 'M', 'N'].map((mod) => {
                  const active = previewMods.includes(mod);
                  return <button type="button" key={mod} className={`pet-mod-option ${active ? 'active' : ''}`} onClick={() => onToggleNewMod(mod)}><strong>{mod}</strong><span>{MOD_LABELS[mod]}</span></button>;
                })}
              </div>
            </div>

            <div className="pet-preview-card">
              <img src={newPet.imageUrl || '/default-item.png'} alt="" onError={(event) => { event.currentTarget.src = '/default-item.png'; }} />
              <div><span className="pet-preview-label">Preview</span><strong>{newPet.name || 'Your new pet'}</strong><small>{newPet.rarity || 'common'} · {previewValue.toLocaleString()} AMP</small></div>
              <ModBadges mods={previewMods} size={17} />
            </div>

            <button type="submit" className="btn btn-primary pet-save-button"><Icon name="plus" size={15} /> Save pet to catalog</button>
            <p className="pet-form-hint">Values are recalculated on the server so modifiers never compound accidentally.</p>
          </form>
        </section>

        <section className="pet-catalog-card">
          <div className="pet-card-heading pet-catalog-heading">
            <div><span className="pet-card-kicker">Catalog</span><h3>All pets</h3></div>
            <span className="pet-results-count">{filteredItems.length} shown</span>
          </div>

          <div className="pet-catalog-toolbar">
            <div className="pet-catalog-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pets..." aria-label="Search pet catalog" /></div>
            <select value={rarity} onChange={(event) => setRarity(event.target.value)} aria-label="Filter pet rarity">{RARITIES.map((option) => <option value={option} key={option}>{option === 'all' ? 'All rarities' : option[0].toUpperCase() + option.slice(1)}</option>)}</select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort pet catalog"><option value="name">Name</option><option value="value-high">Value: high</option><option value="value-low">Value: low</option><option value="newest">Newest</option></select>
          </div>

          {isOwner && <details className="pet-owner-tools"><summary><span><Icon name="shield" size={14} /> Owner tools</span><small>Bulk catalog controls</small></summary><div className="pet-owner-tools-body"><button type="button" className={`btn ${purgeArmed ? 'btn-warning' : 'btn-danger'}`} onClick={onPurge} disabled={purgeBusy}>{purgeBusy ? 'Deleting...' : purgeArmed ? 'Click again to delete commons' : 'Delete common + uncommon'}</button><div className="pet-wipe-row"><input value={wipeName} onChange={(event) => setWipeName(event.target.value)} placeholder="Exact pet name to wipe everywhere" /><button type="button" className={`btn ${wipeArmed ? 'btn-warning' : 'btn-danger'}`} onClick={onWipe} disabled={wipeBusy}>{wipeBusy ? 'Wiping...' : wipeArmed ? 'Click again to confirm' : 'Wipe everywhere'}</button></div></div></details>}

          <div className="pet-catalog-grid">
            {filteredItems.length > 0 ? filteredItems.map((pet) => {
              const mods = normalizeMods(pet.mods);
              const baseValue = baseValueOf(pet);
              const petId = pet.id || pet.itemId;
              return <article className={`pet-catalog-item ${pet.isEnabled === false ? 'disabled' : ''}`} key={petId}>
                <div className="pet-catalog-image"><img src={itemImage(pet)} alt={itemName(pet)} onError={(event) => { event.currentTarget.src = '/default-item.png'; }} /><span className={`pet-rarity-dot ${pet.rarity || 'common'}`} /></div>
                <div className="pet-catalog-copy"><strong title={itemName(pet)}>{itemName(pet)}</strong><span>{Number(pet.value || 0).toLocaleString()} AMP</span><small>{pet.description || `${pet.rarity || 'common'} pet`}</small></div>
                <div className="pet-catalog-mods"><ModBadges mods={mods} size={15} /><span>base {baseValue.toLocaleString()}</span></div>
                <div className="pet-catalog-mod-buttons">{['F', 'R', 'M', 'N'].map((mod) => <button type="button" key={mod} className={mods.includes(mod) ? 'active' : ''} disabled={modBusyId === petId} onClick={() => onTogglePetMod(pet, mod)} title={MOD_LABELS[mod]}>{mod}</button>)}</div>
                <button type="button" className="pet-remove-button" onClick={() => { if (window.confirm(`Remove ${itemName(pet)} from the catalog?`)) onRemovePet(petId); }} aria-label={`Remove ${itemName(pet)}`}><Icon name="close" size={13} /></button>
              </article>;
            }) : <div className="pet-catalog-empty"><Icon name="search" size={24} /><strong>No pets match</strong><span>Try a different search or rarity.</span></div>}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminPetsTab;
