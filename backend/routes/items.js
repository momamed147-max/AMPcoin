const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const dbManager = require('../db/dbHelper');
const { normalizeMods, moddedValue } = require('../lib/petMods');

// Get all items
router.get('/', (req, res) => {
  try {
    const { rarity, search } = req.query;
    const itemsDb = dbManager.getItemsDb();
    let filteredItems = (itemsDb.items || []).filter(item => item.isEnabled !== false);

    if (rarity) {
      filteredItems = filteredItems.filter(item => item.rarity && item.rarity.toLowerCase() === rarity.toLowerCase());
    }

    if (search) {
      const term = search.toLowerCase();
      filteredItems = filteredItems.filter(item => 
        (item.name && item.name.toLowerCase().includes(term)) ||
        (item.description && item.description.toLowerCase().includes(term))
      );
    }

    res.json(filteredItems);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get item by ID
router.get('/:id', (req, res) => {
  try {
    const itemsDb = dbManager.getItemsDb();
    const item = (itemsDb.items || []).find(i => (i.id === req.params.id || i.itemId === req.params.id) && i.isEnabled !== false);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    res.json(item);
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Add new item
router.post('/', authenticateAdmin, (req, res) => {
  try {
    const {
      name,
      description,
      imageUrl,
      rarity,
      value,
      baseValue,
      mods,
      tradable
    } = req.body || {};
    const cleanName = String(name || '').trim();
    const cleanRarity = String(rarity || 'common').toLowerCase();
    const numericBase = Number(baseValue !== undefined && baseValue !== '' ? baseValue : value);
    const validRarities = new Set(['common', 'uncommon', 'rare', 'ultra_rare', 'epic', 'legendary', 'mythic']);
    const fieldErrors = {};

    if (!cleanName) fieldErrors.name = 'Pet name is required.';
    else if (cleanName.length > 80) fieldErrors.name = 'Pet name must be 80 characters or fewer.';
    if (!validRarities.has(cleanRarity)) fieldErrors.rarity = 'Choose a valid rarity.';
    if (!Number.isFinite(numericBase) || numericBase < 0 || numericBase > 1000000000) {
      fieldErrors.value = 'Value must be a number between 0 and 1,000,000,000 AMP.';
    }
    const cleanImageUrl = String(imageUrl || '').trim();
    if (cleanImageUrl && !/^(https?:\/\/|data:image\/|\/)/i.test(cleanImageUrl)) {
      fieldErrors.imageUrl = 'Use an http(s), data, or site-relative image URL.';
    }
    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({ message: 'Please fix the highlighted fields.', fieldErrors });
    }

    const itemsDb = dbManager.getItemsDb();
    const duplicate = (itemsDb.items || []).find((item) =>
      String(item.name || '').trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ message: 'A pet with that name already exists.', fieldErrors: { name: 'Name already exists.' } });
    }

    const id = uuidv4();
    const normalizedMods = normalizeMods(mods);
    const newItem = {
      id,
      itemId: id,
      name: cleanName,
      itemName: cleanName,
      description: String(description || '').trim(),
      imageUrl: cleanImageUrl,
      image: cleanImageUrl,
      rarity: cleanRarity,
      baseValue: numericBase,
      mods: normalizedMods,
      value: moddedValue(numericBase, normalizedMods),
      tradable: tradable !== undefined ? !!tradable : true,
      isEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    itemsDb.items.push(newItem);
    dbManager.saveItemsDb();
    res.status(201).json({ item: newItem, pet: newItem });
  } catch (error) {
    console.error('Error adding item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Update item
router.put('/:id', authenticateAdmin, (req, res) => {
  try {
    const itemId = req.params.id;
    const itemsDb = dbManager.getItemsDb();
    const itemIndex = (itemsDb.items || []).findIndex((item) => item.id === itemId || item.itemId === itemId);
    if (itemIndex === -1) return res.status(404).json({ message: 'Item not found' });

    const current = itemsDb.items[itemIndex];
    const currentName = String(current.name || '');
    const updates = req.body || {};
    const fieldErrors = {};
    const nextName = updates.name !== undefined ? String(updates.name || '').trim() : currentName;
    const nextRarity = updates.rarity !== undefined ? String(updates.rarity || '').toLowerCase() : current.rarity;
    const nextBase = updates.baseValue !== undefined
      ? Number(updates.baseValue)
      : updates.value !== undefined && updates.mods === undefined
        ? Number(updates.value)
        : Number(current.baseValue ?? current.value ?? 0);
    const nextMods = updates.mods !== undefined ? normalizeMods(updates.mods) : normalizeMods(current.mods);
    const validRarities = new Set(['common', 'uncommon', 'rare', 'ultra_rare', 'epic', 'legendary', 'mythic']);

    if (!nextName) fieldErrors.name = 'Pet name is required.';
    if (!validRarities.has(nextRarity)) fieldErrors.rarity = 'Choose a valid rarity.';
    if (!Number.isFinite(nextBase) || nextBase < 0 || nextBase > 1000000000) {
      fieldErrors.value = 'Value must be a number between 0 and 1,000,000,000 AMP.';
    }
    if (nextName.toLowerCase() !== currentName.toLowerCase()) {
      const duplicate = (itemsDb.items || []).find((item, index) =>
        index !== itemIndex && String(item.name || '').trim().toLowerCase() === nextName.toLowerCase()
      );
      if (duplicate) fieldErrors.name = 'Name already exists.';
    }
    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({ message: 'Please fix the highlighted fields.', fieldErrors });
    }

    const nextImageUrl = updates.imageUrl !== undefined ? String(updates.imageUrl || '').trim() : current.imageUrl || '';
    if (nextImageUrl && !/^(https?:\/\/|data:image\/|\/)/i.test(nextImageUrl)) {
      return res.status(400).json({ message: 'Use an http(s), data, or site-relative image URL.', fieldErrors: { imageUrl: 'Invalid image URL.' } });
    }

    const allowed = {
      name: nextName,
      itemName: nextName,
      description: updates.description !== undefined ? String(updates.description || '').trim() : current.description || '',
      imageUrl: nextImageUrl,
      image: nextImageUrl,
      rarity: nextRarity,
      baseValue: nextBase,
      mods: nextMods,
      value: moddedValue(nextBase, nextMods),
      tradable: updates.tradable !== undefined ? !!updates.tradable : current.tradable !== false,
      isEnabled: updates.isEnabled !== undefined ? !!updates.isEnabled : current.isEnabled !== false,
      updatedAt: new Date().toISOString()
    };
    itemsDb.items[itemIndex] = { ...current, ...allowed };
    dbManager.saveItemsDb();
    res.json(itemsDb.items[itemIndex]);
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Delete item
router.delete('/:id', authenticateAdmin, (req, res) => {
  try {
    const itemId = req.params.id;
    const itemsDb = dbManager.getItemsDb();
    const itemIndex = (itemsDb.items || []).findIndex(i => i.id === itemId || i.itemId === itemId);

    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found' });
    }

    itemsDb.items.splice(itemIndex, 1);
    dbManager.saveItemsDb();

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user inventory
router.get('/user/:identifier/inventory', authenticateToken, (req, res) => {
  try {
    const usersDb = dbManager.getUsersDb();
    const user = usersDb.users.find(u => u.id === req.params.identifier || u.robloxUsername === req.params.identifier);
    const userId = user ? user.id : req.user.userId;
    const inventory = dbManager.getUserInventory(userId);
    res.json(inventory);
  } catch (error) {
    console.error('Error fetching user inventory:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;