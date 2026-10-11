import React, { forwardRef } from 'react';
import Icon from '../components/Icon';
import './ui.css';

/**
 * The shared UI primitives.
 *
 * Every page used to hand-roll its own button, panel, empty state and spinner,
 * which is why the same idea looked four different ways across four screens.
 * These are the canonical versions; new UI should use them, and old UI should
 * be migrated to them rather than copying again.
 *
 * Everything is unstyled by default in JS and driven by the CSS classes in
 * ui.css, so a page can still override with className without fighting it.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ── Button ─────────────────────────────────────────────────────────────────
   One component for every press target. `variant` picks the visual weight,
   `size` the height, and `loading` swaps the label for a spinner and disables
   it — so a page can never show a button that looks dead while its action is
   still in flight. */
export const Button = forwardRef(function Button({
  children,
  variant = 'default', // default | primary | ghost | danger | subtle
  size = 'md',          // sm | md | lg
  loading = false,
  disabled = false,
  icon,
  iconRight,
  full = false,
  className,
  type = 'button',
  ...rest
}, ref) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'ui-btn',
        `ui-btn-${variant}`,
        `ui-btn-${size}`,
        full && 'ui-btn-full',
        loading && 'is-loading',
        className
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ui-btn-spin" aria-hidden="true" />}
      {!loading && icon && <Icon name={icon} size={14} />}
      <span className="ui-btn-label">{children}</span>
      {!loading && iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
});

/* ── Panel ───────────────────────────────────────────────────────────────────
   The standard surface. `as` lets a section become a section/article so the
   markup stays semantic. */
export function Panel({
  as: Tag = 'div',
  title,
  subtitle,
  actions,
  padded = true,
  tone, // default | accent | danger | success
  className,
  children,
  ...rest
}) {
  return (
    <Tag className={cx('ui-panel', padded && 'ui-panel-pad', tone && `ui-panel-${tone}`, className)} {...rest}>
      {(title || actions || subtitle) && (
        <header className="ui-panel-head">
          <div className="ui-panel-heading">
            {title && <h3 className="ui-panel-title">{title}</h3>}
            {subtitle && <p className="ui-panel-sub">{subtitle}</p>}
          </div>
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

/* ── EmptyState ───────────────────────────────────────────────────────────────
   An empty list is not an error and it is not nothing to say. This gives every
   empty list the same shape, with an optional action. */
export function EmptyState({ icon = 'search', title, message, action, className }) {
  return (
    <div className={cx('ui-empty', className)} role="status">
      <div className="ui-empty-icon"><Icon name={icon} size={30} /></div>
      {title && <p className="ui-empty-title">{title}</p>}
      {message && <p className="ui-empty-message">{message}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

/* ── ErrorState ───────────────────────────────────────────────────────────────
   Every failed load used to render nothing, or a bare string. This always
   offers a retry, so a transient blip is one click from recovered. */
export function ErrorState({ title = 'Something went wrong', message, onRetry, className }) {
  return (
    <div className={cx('ui-empty ui-error', className)} role="alert">
      <div className="ui-empty-icon"><Icon name="warn" size={30} /></div>
      <p className="ui-empty-title">{title}</p>
      {message && <p className="ui-empty-message">{message}</p>}
      {onRetry && (
        <div className="ui-empty-action">
          <Button variant="primary" icon="rpsRock" onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────────────────
   A placeholder that matches the shape of the content it stands in for, so the
   layout does not jump when the real data lands. */
export function Skeleton({ w = '100%', h = 14, r, className, style }) {
  return (
    <span
      className={cx('ui-skel', className)}
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: r ?? 'var(--r-sm)', ...style }}
    />
  );
}

export function SkeletonRows({ rows = 3, h = 44 }) {
  return (
    <div className="ui-skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={h} />)}
    </div>
  );
}

/* ── Badge ────────────────────────────────────────────────────────────────────
   A small status pill. `tone` is the only thing that varies. */
export function Badge({ children, tone = 'neutral', className, title }) {
  return <span className={cx('ui-badge', `ui-badge-${tone}`, className)} title={title}>{children}</span>;
}

/* ── StatTile ──────────────────────────────────────────────────────────────────
   One number with a label. Used by the stats and achievements screens, and by
   any header that wants a figure rather than a sentence. */
export function StatTile({ label, value, sub, tone, icon, className }) {
  return (
    <div className={cx('ui-stat', tone && `ui-stat-${tone}`, className)}>
      {icon && <div className="ui-stat-icon"><Icon name={icon} size={15} /></div>}
      <div className="ui-stat-body">
        <span className="ui-stat-label">{label}</span>
        <span className="ui-stat-value">{value}</span>
        {sub && <span className="ui-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

export function StatGrid({ children, cols, className }) {
  return (
    <div
      className={cx('ui-stat-grid', className)}
      style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {children}
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────────────
   Underlined tabs. Keyboard: left/right move between them, as a tablist
   should. */
export function Tabs({ value, onChange, items, className }) {
  const onKeyDown = (event) => {
    const i = items.findIndex((t) => t.id === value);
    if (i < 0) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(items[(i + 1) % items.length].id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(items[(i - 1 + items.length) % items.length].id);
    }
  };
  return (
    <div className={cx('ui-tabs', className)} role="tablist" onKeyDown={onKeyDown}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className={cx('ui-tab', t.id === value && 'is-active')}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={14} />}
          {t.label}
          {t.count > 0 && <span className="ui-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Progress ───────────────────────────────────────────────────────────────────
   `value` is clamped to 0..100 and `max` lets a bar show 7 of 30 rather than
   inventing a percentage. */
export function Progress({ value = 0, max = 100, label, showValue = false, className }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cx('ui-progress-wrap', className)}>
      {(label || showValue) && (
        <div className="ui-progress-head">
          {label && <span className="ui-progress-label">{label}</span>}
          {showValue && <span className="ui-progress-value">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className="ui-progress"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'progress'}
      >
        <span className="ui-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Money ─────────────────────────────────────────────────────────────────────
   Value figures are tabular so a column of them lines up, and the tone is
   carried by colour plus a sign rather than colour alone. */
export function Amount({ value, sign = false, tone, className, compact: isCompact = false }) {
  const n = Number(value) || 0;
  const shown = isCompact ? compactNumber(n) : n.toLocaleString();
  const prefix = sign && n > 0 ? '+' : '';
  const auto = n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat';
  return (
    <span className={cx('ui-amount', `ui-amount-${tone || auto}`, className)}>
      {prefix}{shown}
    </span>
  );
}

export function compactNumber(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

/* ── Field ─────────────────────────────────────────────────────────────────────
   Label + control + hint + error, wired up with the right ids so the label is
   actually clickable and a screen reader hears the error. */
export const Field = forwardRef(function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor
}, ref) {
  return (
    <div className={cx('ui-field', error && 'has-error', className)}>
      {label && <label className="ui-field-label" htmlFor={htmlFor}>{label}{required && <span className="ui-req"> *</span>}</label>}
      {children}
      {error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
    </div>
  );
});

export default Button;