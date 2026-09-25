import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiConfig';

const AuthContext = createContext();
const DEFAULT_AVATAR = '/default-avatar.png';

export const useAuth = () => useContext(AuthContext);

function getFallbackAvatar(user) {
  if (!user) return DEFAULT_AVATAR;
  if (user.robloxUserId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${user.robloxUserId}&width=420&height=420&format=png`;
  }
  return DEFAULT_AVATAR;
}

function enhanceUserWithRoblox(user, profileData) {
  if (!user) return null;
  const avatar = profileData?.avatar || user.avatar || getFallbackAvatar(user);
  const displayName =
    profileData?.displayName ||
    user.robloxDisplayName ||
    user.displayName ||
    user.robloxUsername ||
    'Anonymous';
  return {
    ...user,
    avatar,
    robloxDisplayName: displayName,
    robloxUserId: profileData?.robloxUserId || user.robloxUserId || null,
    displayName
  };
}

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const resolveRobloxProfile = useCallback(async (robloxUsername) => {
    if (!robloxUsername) return null;
    try {
      const res = await fetch(
        `${API_BASE}/api/users/profile/${encodeURIComponent(robloxUsername)}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`
          }
        }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }, []);

  const persistUser = useCallback((userObj) => {
    if (!userObj) return;
    localStorage.setItem('user', JSON.stringify(userObj));
  }, []);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');

      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Verify token to get the latest server-side data (includes avatar if cached)
      let freshUser = null;
      try {
        const res = await fetch(`${API_BASE}/api/auth/verify-token`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid && data.user) {
            freshUser = data.user;
          }
        }
      } catch (err) {
        console.warn('Verify token failed:', err.message);
      }

      // Fall back to stored user
      let parsedUser = freshUser;
      if (!parsedUser && storedUser) {
        parsedUser = JSON.parse(storedUser);
      }

      if (!parsedUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Ensure we have a fresh avatar via Roblox profile endpoint
      let profileData = null;
      if (!parsedUser.avatar || !parsedUser.robloxDisplayName) {
        profileData = await resolveRobloxProfile(
          parsedUser.robloxUsername || parsedUser.id
        );
      }

      const enhanced = enhanceUserWithRoblox(parsedUser, profileData);
      persistUser(enhanced);
      setUser(enhanced);
    } catch (error) {
      console.error('Error refreshing user:', error);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } finally {
      setLoading(false);
    }
  }, [persistUser, resolveRobloxProfile]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (credentials) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.token);
        const profileData = await resolveRobloxProfile(data.user?.robloxUsername);
        const enhanced = enhanceUserWithRoblox(data.user, profileData);
        persistUser(enhanced);
        setUser(enhanced);

        try {
          const userData = {
            id: enhanced.id,
            username: enhanced.robloxUsername,
            display: enhanced.displayName,
            lastLogin: new Date().toISOString()
          };
          console.log('User logged in:', userData);
        } catch (err) {
          console.error('Error logging user:', err);
        }

        return { success: true, user: enhanced };
      } else {
        return { success: false, message: data.message || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: error.message || 'Network error. Please try again.' };
    }
  };

  const register = async (userData) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.token);
        const profileData = await resolveRobloxProfile(data.user?.robloxUsername);
        const enhanced = enhanceUserWithRoblox(data.user, profileData);
        persistUser(enhanced);
        setUser(enhanced);

        try {
          const newUserRecord = {
            id: enhanced.id,
            username: enhanced.robloxUsername,
            display: enhanced.displayName,
            registeredAt: new Date().toISOString()
          };
          console.log('User registered:', newUserRecord);
        } catch (err) {
          console.error('Error logging user registration:', err);
        }

        return { success: true, user: enhanced };
      } else {
        return { success: false, message: data.message || 'Registration failed' };
      }
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, message: error.message || 'Network error. Please try again.' };
    }
  };

  // Step 1 of bio-verified registration: resolve a Roblox account (public)
  const resolveRobloxAccount = async (username) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/roblox/${encodeURIComponent(username)}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok) return { success: true, account: data };
      return { success: false, message: data.message || 'Roblox user not found' };
    } catch (error) {
      return { success: false, message: error.message || 'Network error. Please try again.' };
    }
  };

  // Step 2: backend issues the "AMPbet | word word word word" bio code
  const requestVerifyCode = async (robloxUsername) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robloxUsername })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return { success: true, code: data.code };
      return { success: false, message: data.message || 'Could not create code' };
    } catch (error) {
      return { success: false, message: error.message || 'Network error. Please try again.' };
    }
  };

  // Step 3: backend checks the bio for the code, then creates + logs in the user
  const verifyAndRegister = async ({ robloxUsername, password }) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-and-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robloxUsername, password })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        localStorage.setItem('token', data.token);
        const profileData = await resolveRobloxProfile(data.user?.robloxUsername);
        const enhanced = enhanceUserWithRoblox(data.user, profileData);
        persistUser(enhanced);
        setUser(enhanced);
        return { success: true, user: enhanced };
      }
      return { success: false, message: data.message || 'Verification failed' };
    } catch (error) {
      return { success: false, message: error.message || 'Network error. Please try again.' };
    }
  };

  const updateUserBalance = useCallback(
    (newBalance) => {
      setUser((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, balance: newBalance };
        persistUser(updated);
        return updated;
      });
    },
    [persistUser]
  );

  const updateUser = useCallback(
    (patch) => {
      setUser((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, ...patch };
        persistUser(updated);
        return updated;
      });
    },
    [persistUser]
  );

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const isAdmin = useCallback(() => {
    return !!user && !!user.isAdmin;
  }, [user]);

  const value = {
    user,
    login,
    register,
    resolveRobloxAccount,
    requestVerifyCode,
    verifyAndRegister,
    logout,
    loading,
    isAdmin,
    refreshUser,
    updateUserBalance,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
