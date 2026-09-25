import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !user.isAdmin) {
    return (
      <div className="request-state" role="alert">
        <Icon name="lock" size={26} />
        <strong>Admin access required</strong>
        <span>Your account does not have permission to open this area.</span>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/coinflip')}>
          Return to Coinflip
        </button>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;