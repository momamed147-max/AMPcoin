import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../apiConfig';

const StatsPage = () => {
  const { user } = useAuth();
  const [globalStats, setGlobalStats] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [globalRes, userRes] = await Promise.all([
          fetch(`${API_BASE}/api/stats/global`),
          fetch(`${API_BASE}/api/stats/user/${user?.id}`)
        ]);

        const globalData = await globalRes.json();
        const userData = await userRes.json();

        setGlobalStats(globalData);
        setUserStats(userData);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching stats:', error);
        setLoading(false);
      }
    };

    if (user) {
      fetchStats();
    }
  }, [user]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading statistics...</p>
      </div>
    );
  }

  return (
    <div className="stats-page">
      <div className="page-header">
        <h1>Statistics</h1>
      </div>

      <div className="stats-grid">
        <div className="stats-section">
          <h3>Global Statistics</h3>
          <div className="stats-cards">
            <div className="stat-card">
              <div className="stat-value">{globalStats?.totalWagered?.toLocaleString()}</div>
              <div className="stat-label">Total AMP Wagered</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{globalStats?.totalCoinflips}</div>
              <div className="stat-label">Total Coinflips</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{globalStats?.totalBlackjackGames}</div>
              <div className="stat-label">Total Blackjack Games</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{globalStats?.totalWins}</div>
              <div className="stat-label">Total Wins</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{globalStats?.totalLosses}</div>
              <div className="stat-label">Total Losses</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{globalStats?.totalTaxesCollected?.toLocaleString()}</div>
              <div className="stat-label">Total Taxes Collected</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{globalStats?.biggestWin?.toLocaleString()}</div>
              <div className="stat-label">Biggest Win</div>
            </div>
          </div>
        </div>

        <div className="stats-section">
          <h3>Your Statistics</h3>
          <div className="stats-cards">
            <div className="stat-card">
              <div className="stat-value">{userStats?.totalWagered?.toLocaleString()}</div>
              <div className="stat-label">Total Wagered</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.totalWon?.toLocaleString()}</div>
              <div className="stat-label">Total Won</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.totalLost?.toLocaleString()}</div>
              <div className="stat-label">Total Lost</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.coinflipWins}</div>
              <div className="stat-label">Coinflip Wins</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.coinflipLosses}</div>
              <div className="stat-label">Coinflip Losses</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.blackjackWins}</div>
              <div className="stat-label">Blackjack Wins</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.blackjackLosses}</div>
              <div className="stat-label">Blackjack Losses</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.winRate}%</div>
              <div className="stat-label">Win Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.biggestWin?.toLocaleString()}</div>
              <div className="stat-label">Biggest Win</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{userStats?.totalTaxPaid?.toLocaleString()}</div>
              <div className="stat-label">Total Tax Paid</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsPage;