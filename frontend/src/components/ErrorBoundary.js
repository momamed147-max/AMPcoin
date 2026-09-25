import React from 'react';
import Icon from './Icon';

/**
 * Keeps a single panel from taking down the whole app. If something inside
 * throws while rendering, show the message in place instead of white-screening
 * the site, and expose the error text so it can actually be diagnosed.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || 'panel', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { label, onClose } = this.props;
    return (
      <div className="eb-fallback">
        <div className="eb-fallback-card">
          <div className="eb-fallback-icon"><Icon name="warn" size={22} /></div>
          <strong>{label || 'This panel'} could not be displayed</strong>
          <span className="eb-fallback-msg">{String(this.state.error?.message || this.state.error)}</span>
          {onClose && (
            <button type="button" className="eb-fallback-btn" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
