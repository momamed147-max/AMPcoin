import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiConfig';
import {
  getRememberedDevice,
  saveRememberedDevice,
  removeRememberedDevice
} from '../rememberedDevice';

const AuthContextDefault = createContext();
const DEFAULT_AVATAR = '/default-avatar.svg';

// Exported so a test can supply a user without standing up the whole provider.
// createContext() is called with no default, so useAuth() outside a provider
// returns undefined and every consumer that destructures it throws.
export const AuthContext = AuthContextDefault;
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
  const robloxName =
    profileData?.robloxDisplayName ||
    profileData?.displayName ||
    user.robloxDisplayName ||
    user.displayName ||
    user.robloxUsername ||
    'Anonymous';
  const inferredCustomDisplayName =
    user.customDisplayName !== undefined
      ? user.customDisplayName
      : user.robloxDisplayName && user.displayName && user.displayName !== user.robloxDisplayName
        ? user.displayName
        : null;
  const customDisplayName = inferredCustomDisplayName || null;
  const displayName = customDisplayName || robloxName;
  return {
    ...user,
    avatar,
    robloxDisplayName: robloxName,
    customDisplayName,
    robloxUserId: profileData?.robloxUserId || user.robloxUserId || null,
    isAdmin: user.isAdmin === true,
    isModerator: user.isModerator === true,
    isMuted: user.isMuted === true,
    muteReason: user.muteReason || null,
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

  const forgetRememberedDevice = useCallback(async (username) => {
    const removed = removeRememberedDevice(username);
    if (!removed) return;
    try {
      await fetch(`${API_BASE}/api/auth/remember-forget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: removed.token })
      });
    } catch (_) {
      // The local token is already gone. A stale server record will expire.
    }
  }, []);

  const handleRememberedSession = useCallback((data, username, rememberRequested) => {
    if (rememberRequested === true && data?.rememberToken && data?.rememberExpiresAt) {
      saveRememberedDevice({
        username,
        token: data.rememberToken,
        expiresAt: data.rememberExpiresAt
      });
      return true;
    }
    if (rememberRequested === false) {
      void forgetRememberedDevice(username);
    }
    return false;
  }, [forgetRememberedDevice]);

  const refreshUser = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');

      if (!token) {
        setUser(null);
        return;
      }

      // Verify token to get the latest server-side data (includes avatar if cached)
      let freshUser = null;
      let tokenRejected = false;
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
        } else if (res.status === 401) {
          // Server rejected the signature (expired, or JWT_SECRET was rotated).
          // Falling through to the cached user here would leave the session
          // looking logged in while every authenticated call 401s.
          tokenRejected = true;
        }
      } catch (err) {
        console.warn('Verify token failed:', err.message);
      }

      if (tokenRejected) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        return;
      }

      // Fall back to stored user
      let parsedUser = freshUser;
      if (!parsedUser && storedUser) {
        parsedUser = JSON.parse(storedUser);
      }

      if (!parsedUser) {
        setUser(null);
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
      if (showLoading) setLoading(false);
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
        handleRememberedSession(data, enhanced.robloxUsername, credentials?.remember);

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

  const rememberedLogin = async (robloxUsername) => {
    const entry = getRememberedDevice(robloxUsername);
    if (!entry) {
      return { success: false, message: 'This device is not remembered.' };
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/remember-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robloxUsername: entry.username, token: entry.token })
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        localStorage.setItem('token', data.token);
        const profileData = await resolveRobloxProfile(data.user?.robloxUsername);
        const enhanced = enhanceUserWithRoblox(data.user, profileData);
        persistUser(enhanced);
        setUser(enhanced);

        // A future server version may rotate the device token on use. Keep the
        // browser in step when it does, and leave the existing token alone when
        // it does not.
        if (data.rememberToken && data.rememberExpiresAt) {
          saveRememberedDevice({
            username: enhanced.robloxUsername || entry.username,
            token: data.rememberToken,
            expiresAt: data.rememberExpiresAt
          });
        }

        return { success: true, user: enhanced, remembered: true };
      }

      // A rejected token, or one used from a different network, is no longer
      // useful on this browser. Remove it so the normal code flow can replace
      // it cleanly, and revoke the server record so it does not linger. Server
      // errors are left alone.
      if (response.status === 401 || response.status === 403) {
        void forgetRememberedDevice(entry.username);
      }
      return {
        success: false,
        code: data.code || '',
        message: data.message || 'This device is not remembered.'
      };
    } catch (error) {
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

  // Step 2: backend issues a seven-word bio code
  const devLogin = useCallback(async (username) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { success: false, message: data.message || 'Local test login failed' };
      localStorage.setItem('token', data.token);
      const enhanced = enhanceUserWithRoblox(data.user, null);
      persistUser(enhanced);
      setUser(enhanced);
      return { success: true, user: enhanced };
    } catch (error) {
      return { success: false, message: error.message || 'Local test login failed' };
    }
  }, [persistUser]);

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
  const verifyAndRegister = async ({ robloxUsername, password, remember }) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-and-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robloxUsername, password, remember: remember === true })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        localStorage.setItem('token', data.token);
        const profileData = await resolveRobloxProfile(data.user?.robloxUsername);
        const enhanced = enhanceUserWithRoblox(data.user, profileData);
        persistUser(enhanced);
        setUser(enhanced);
        handleRememberedSession(data, enhanced.robloxUsername || robloxUsername, remember);
        return { success: true, user: enhanced };
      }
      return { success: false, message: data.message || 'Verification failed' };
    } catch (error) {
      return { success: false, message: error.message || 'Network error. Please try again.' };
    }
  };

  // Cash balance was removed as a feature - no game settled against it and
  // nothing paid it out. Anything that used to call this was decrementing a
  // figure that had no effect on any wager.

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

  const isModerator = useCallback(() => {
    return !!user && !!user.isModerator && !user.isAdmin;
  }, [user]);

  const isStaff = useCallback(() => {
    return !!user && (!!user.isAdmin || !!user.isModerator);
  }, [user]);

  const value = {
    user,
    login,
    devLogin,
    register,
    resolveRobloxAccount,
    requestVerifyCode,
    verifyAndRegister,
    rememberedLogin,
    forgetRememberedDevice,
    logout,
    loading,
    isAdmin,
    isModerator,
    isStaff,
    refreshUser,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
