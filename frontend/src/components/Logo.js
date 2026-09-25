import React, { useId } from 'react';

/* AMPcoin logo — poker-chip "A" mark + wordmark. Pure SVG, no assets. */
const LogoMark = ({ size = 32 }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const spots = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`ac-${uid}`} cx="42%" cy="38%" r="72%">
          <stop offset="0%" stopColor="var(--acc-bright, #76a9ff)" />
          <stop offset="55%" stopColor="var(--acc, #4c8dff)" />
          <stop offset="100%" stopColor="var(--theme-accent-2, var(--acc))" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="var(--bg0, #060910)" />
      <circle cx="50" cy="50" r="48" fill="none" stroke="var(--line, rgba(137,166,204,.16))" strokeWidth="2" />
      {spots.map((deg) => (
        <rect
          key={deg}
          x="44"
          y="3.5"
          width="12"
          height="13"
          rx="3"
          fill="var(--txt, #f4f7fb)"
          transform={`rotate(${deg} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="34" fill="none" stroke="var(--txt, #f4f7fb)" strokeWidth="3.5" />
      <circle cx="50" cy="50" r="29" fill={`url(#ac-${uid})`} />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Chakra Petch', 'Segoe UI', sans-serif"
        fontWeight="700"
        fontSize="38"
        fill="#ffffff"
      >
        A
      </text>
      <ellipse cx="40" cy="32" rx="14" ry="7" fill="var(--txt, #f4f7fb)" opacity="0.22" transform="rotate(-24 40 32)" />
    </svg>
  );
};

const Logo = ({ size = 32, showText = true, textSize }) => (
  <span className="amp-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
    <LogoMark size={size} />
    {showText && (
      <span
        className="logo-text"
        style={textSize ? { fontSize: textSize } : undefined}
      >
        AMPcoin
      </span>
    )}
  </span>
);

export default Logo;
