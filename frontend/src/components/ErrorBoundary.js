import React from 'react';
import Icon from './Icon';

/**
 * Keeps one panel from taking down the whole app: if something inside throws
 * while rendering, show the message in place instead of white-screening the
 * site.
 *
 * The important part is `reset`. Without it a boundary that has caught once
 * stays broken for the rest of the session - every later attempt to open the
 * panel shows the same error even though the cause is long gone, which reads as
 * "this page is permanently broken". A boundary should get a second chance when
 * the thing that threw it changes.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: 0 };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || 'panel', error, info?.componentStack);
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, info);
    }
  }

  reset() {
    // Bumping the key remounts the subtree, so React throws away the broken
    // element instead of reusing it.
    this.setState((prev) => ({ error: null, key: prev.key + 1 }));
    if (typeof this.props.onReset === 'function') this.props.onReset();
  }

  render() {
    const { error, key } = this.state;
    if (!error) {
      return <React.Fragment key={key}>{this.props.children}</React.Fragment>;
    }
    const { label, onClose } = this.props;
    const message = String(error?.message || error);
    return (
      <div className="eb-fallback">
        <div className="eb-fallback-card">
          <div className="eb-fallback-icon"><Icon name="warn" size={22} /></div>
          <strong>{label || 'This panel'} could not be displayed</strong>
          <span className="eb-fallback-msg">{message}</span>
          <div className="eb-fallback-actions">
            <button type="button" className="eb-fallback-btn primary" onClick={this.reset}>
              Try again
            </button>
            {onClose && (
              <button type="button" className="eb-fallback-btn" onClick={onClose}>Close</button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;