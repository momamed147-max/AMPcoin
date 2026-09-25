import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import AnimatedPopup from '../components/AnimatedPopup';
import Icon from '../components/Icon';
import { API_BASE } from '../apiConfig';
import './WalletPage.css';

const WalletPage = () => {
  const { user, depositItem, getRarityClass } = useAuth();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [balance, setBalance] = useState(0);
  const [inventory, setInventory] = useState([]);
  const [activeTab, setActiveTab] = useState('deposit'); // 'deposit' or 'withdraw'
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const [popupType, setPopupType] = useState('info');
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAllChecked, setSelectAllChecked] = useState(false);
  const [, setIsLoading] = useState(false);
  const [, setError] = useState(null);
  const [, setSuccessMessage] = useState('');

  const fetchBalance = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      if (response.ok) {
        setBalance(data.balance || 0);
      }
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  };

  const fetchInventory = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(`${API_BASE}/api/users/inventory/${user.id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setInventory(data.items || []);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchBalance();
      fetchInventory();
    }
  }, [user, fetchBalance, fetchInventory]);

  const toggleItemSelection = (itemid) => {
    setSelectedItems(prev => {
      if (prev.includes(itemid)) {
        return prev.filter(id => id !== itemid);
      } else {
        return [...prev, itemid];
      }
    });
  };

  const toggleSelectAll = () => {
    if (selectAllChecked) {
      setSelectedItems([]);
    } else {
      setSelectedItems(inventory.map(item => item.id || item.itemid));
    }
    setSelectAllChecked(!selectAllChecked);
  };

  const calculateTotalInventoryValue = () => {
    return inventory.reduce((sum, item) => sum + (item.value || item.details?.value || 0), 0);
  };

  const showCustomPopup = (message, type = 'info') => {
    setPopupMessage(message);
    setPopupType(type);
    setShowPopup(true);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      setShowPopup(false);
    }, 3000);
  };

  const handleWithdraw = async () => {
    if (selectedItems.length === 0) {
      showCustomPopup('Please select at least one item to withdraw', 'error');
      return;
    }
    
    try {
      // Prepare selected items data
      const selectedItemsData = inventory.filter(item => 
        selectedItems.includes(item.id || item.itemId)
      ).map(item => ({
        itemId: item.id || item.itemid,
        itemName: item.name || item.details?.name,
        value: item.value || item.details?.value || 0,
        rarity: item.rarity || item.details?.rarity
      }));
      
      const response = await fetch(`${API_BASE}/api/wallet/withdraw-items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          items: selectedItemsData,
          address: address || 'Discord Server'
        })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        showCustomPopup('Withdrawal request submitted successfully! Check Admin Panel for approval.', 'success');
        setSelectedItems([]);
        setSelectAllChecked(false);
        setAddress('');
        // Refresh inventory and balance
        fetchInventory();
      } else {
        showCustomPopup(result.message || 'Failed to submit withdrawal', 'error');
      }
    } catch (error) {
      showCustomPopup('Error submitting withdrawal request', 'error');
    }
  };

  const handleDeposit = async (item) => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Try to deposit item through the context function first
      if (depositItem) {
        depositItem(item);
      }
      
      // If that fails, try to call the API directly
      const response = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to deposit item');
      }
      
      setSuccessMessage('Item deposited successfully');
      
      // Refresh items through the context function
      if (user && fetchInventory) {
        const updatedInventory = await fetchInventory();
        // Update the inventory state with the fresh data
        setInventory(updatedInventory.items || []);
      }
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError('Failed to deposit item');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const isWithdrawButtonDisabled = selectedItems.length === 0;

  return (
    <div className="wallet-page">
      <div className="page-header">
        <h1>Your Wallet</h1>
        <p>Manage your AMP coins and items</p>
      </div>

      <div className="wallet-overview">
        <div className="balance-card">
          <div className="balance-info">
            <h2>Your Balance</h2>
            <p className="balance-amount">{balance?.toLocaleString()} AMP</p>
            <p className="inventory-value">Inventory Value: {calculateTotalInventoryValue()?.toLocaleString()} AMP</p>
          </div>
          <button 
            className="btn btn-primary wallet-open-btn"
            onClick={() => setShowWalletModal(true)}
          >
            Open Wallet
          </button>
        </div>
      </div>

      {/* Wallet Modal */}
      {showWalletModal && (
        <div className="wallet-modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal header with deposit button at the top */}
            <div className="wallet-modal-header">
              <div className="modal-title-section">
                <h2>Wallet & Inventory</h2>
                <p className="modal-balance">Current Balance: <span className="balance-highlight">{balance?.toLocaleString()} AMP</span></p>
              </div>
              <div className="wallet-actions">
                <button 
                  className="deposit-btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab('deposit');
                    // Show deposit form
                  }}
                  title="Deposit Funds"
                >
                  +
                </button>
                <button 
                  className="modal-close-btn"
                  onClick={() => setShowWalletModal(false)}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal content */}
            <div className="wallet-modal-content">
              {/* Inventory Section - Full width */}
              <div className="inventory-section-full">
                <div className="section-header">
                  <h3>Your Items</h3>
                  <span className="items-count">{inventory.length} items</span>
                </div>
                
                {/* Inventory Grid */}
                <div className="inventory-grid-full">
                  {inventory.length > 0 ? (
                    inventory.map((item) => {
                      // Use consistent itemId handling for backend compatibility
                      const itemId = item.itemId || item.id;
                      // Ensure consistent comparison with selected items
                      const isSelected = selectedItems.some(id => id === itemId);
                      
                      return (
                        <div 
                          key={itemId} 
                          className={`inventory-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleItemSelection(itemId)}
                        >
                          <div className="item-checkbox">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleItemSelection(itemId)}
                            />
                          </div>
                          <div className="item-image-container">
                            {item.details?.imageUrl || item.image ? (
                              <img 
                                src={item.details?.imageUrl || item.image} 
                                alt={item.details?.name || item.name} 
                                className="item-image"
                                onError={(e) => {
                                  e.target.src = '/default-item.png';
                                  e.target.classList.add('default-image');
                                }}
                              />
                            ) : (
                              <div className="default-item-icon"><Icon name="diamond" size={24} /></div>
                            )}
                          </div>
                          <div className="item-details">
                            <h4 className="item-name">{item.details?.name || item.name || 'Unknown Item'}</h4>
                            <p className="item-value">{(item.value || item.details?.value || 0)?.toLocaleString()} AMP</p>
                            <span className={`badge ${getRarityClass(item.details?.rarity || item.rarity || 'common')}`}>
                              {item.details?.rarity || item.rarity}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="no-items-placeholder">
                      <div className="empty-icon"><Icon name="bag" size={32} /></div>
                      <p className="no-items-text">No items in your inventory</p>
                      <p className="no-items-subtext">Start playing games to earn items!</p>
                    </div>
                  )}
                </div>
                
                {/* Bottom action buttons - Select All and Withdraw */}
                <div className="inventory-actions">
                  <button 
                    className="select-all-btn"
                    onClick={toggleSelectAll}
                  >
                    {selectAllChecked ? 'Deselect All' : 'Select All'}
                  </button>
                  
                  <button 
                    className={`withdraw-bottom-btn ${isWithdrawButtonDisabled ? 'disabled' : ''}`}
                    onClick={handleWithdraw}
                    disabled={isWithdrawButtonDisabled}
                  >
                    Withdraw Selected ({selectedItems.length})
                  </button>
                </div>
              </div>

              {/* Transaction Form Section - Only shown when deposit tab is active */}
              {activeTab === 'deposit' && (
                <div className="transaction-section">
                  <h3>Deposit Funds</h3>
                  
                  <div className="transaction-form deposit-form">
                    <div className="form-group">
                      <label>Amount (AMP)</label>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Enter amount to deposit"
                        className="form-control"
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>Deposit Address</label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Your deposit address"
                        className="form-control"
                        readOnly
                      />
                      <small className="form-text">Send AMP coins to this address to deposit</small>
                    </div>
                    <div className="form-actions">
                      <button 
                        className="btn btn-cancel"
                        onClick={() => setShowWalletModal(false)}
                      >
                        Cancel
                      </button>
                      <button 
                        className="btn btn-success"
                        onClick={handleDeposit}
                      >
                        Confirm Deposit
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="wallet-modal-footer">
              <div className="wallet-footer-meta">
                <span>{inventory.length} item{inventory.length === 1 ? '' : 's'}</span>
                <span className="wallet-footer-sep">•</span>
                <span>{selectedItems.length} selected</span>
              </div>
              <div className="wallet-total-box">
                <span className="wallet-total-label">Total inventory value</span>
                <span className="wallet-total-value">{calculateTotalInventoryValue()?.toLocaleString()} AMP</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom animated popup */}
      {showPopup && (
        <AnimatedPopup 
          message={popupMessage} 
          type={popupType} 
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  );
};

export default WalletPage;