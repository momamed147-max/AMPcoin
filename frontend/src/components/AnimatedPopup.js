import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import './AnimatedPopup.css';

const TYPE_META = {
  success: { icon: 'check', label: 'Success' },
  error: { icon: 'warn', label: 'Error' },
  warning: { icon: 'warn', label: 'Warning' },
  info: { icon: 'board', label: 'Information' }
};

const AnimatedPopup = ({
  show = true,
  title,
  message,
  type = 'info',
  duration = 3200,
  onClose
}) => {
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  const meta = TYPE_META[type] || TYPE_META.info;
  const toastDuration = type === 'error' ? Math.max(duration, 6000) : duration;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setClosing(false);
  }, [message, show]);

  useEffect(() => {
    if (!show) return undefined;
    let exitTimer;
    const timer = setTimeout(() => {
      setClosing(true);
      exitTimer = setTimeout(() => {
        if (onCloseRef.current) onCloseRef.current();
      }, 250);
    }, toastDuration);
    return () => {
      clearTimeout(timer);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [toastDuration, show, message]);

  if (!show) return null;

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      if (onClose) onClose();
    }, 250);
  };

  return (
    <div className="apop-overlay" onClick={handleClose}>
      <div
        className={`apop-card apop-${type} ${closing ? 'apop-exit' : 'apop-enter'}`}
        onClick={(e) => e.stopPropagation()}
        role={type === 'error' ? 'alert' : 'status'}
        aria-live={type === 'error' ? 'assertive' : 'polite'}
      >
        <span className="apop-glow" />
        <div className="apop-icon"><Icon name={meta.icon} size={17} /></div>
        <div className="apop-body">
          <div className="apop-title">{title || meta.label}</div>
          {message && <div className="apop-message">{message}</div>}
        </div>
        <button className="apop-x" onClick={handleClose} aria-label="Dismiss notification">
          <Icon name="close" size={14} />
        </button>
        <div
          className="apop-progress"
          style={{ animationDuration: `${toastDuration}ms` }}
        />
      </div>
    </div>
  );
};

export default AnimatedPopup;
