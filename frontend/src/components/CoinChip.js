import React, { useEffect, useRef } from 'react';
import { playCoinflipFlip, playCoinflipLanding } from '../sound';
import './CoinChip.css';

let chipIdCounter = 0;

function useUniqueId(prefix) {
  const ref = useRef(null);
  if (ref.current === null) {
    chipIdCounter += 1;
    ref.current = `${prefix}-${chipIdCounter}`;
  }
  return ref.current;
}

function normalizeSide(side) {
  if (typeof side !== 'string') return 'heads';
  const s = side.trim().toLowerCase();
  if (s === 'heads' || s === 'head' || s === 'h') return 'heads';
  if (s === 'tails' || s === 'tail' || s === 't') return 'tails';
  return 'heads';
}

/* A twelve-sided token, not a poker chip. Points are generated rather than
   hand-written so the rim, face and inset rings share the same geometry and
   the facets line up exactly. */
function ringPoints(radius, count = 12, rotation = -Math.PI / 2) {
  return Array.from({ length: count }, (_, i) => {
    const angle = rotation + (Math.PI * 2 * i) / count;
    return `${120 + radius * Math.cos(angle)},${120 + radius * Math.sin(angle)}`;
  }).join(' ');
}

const OUTER_12 = ringPoints(112);
const RIM_12 = ringPoints(108);
const FACE_12 = ringPoints(97);
const WELL_12 = ringPoints(59);
const TICKS = Array.from({ length: 24 }, (_, i) => i);
const FACETS = Array.from({ length: 12 }, (_, i) => {
  const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 12;
  return {
    x: 120 + 96 * Math.cos(angle),
    y: 120 + 96 * Math.sin(angle)
  };
});

const SIDES = {
  heads: {
    label: 'heads',
    letter: 'H',
    edgeDark: '#043a2f',
    edge: '#67ffd6',
    faceLight: '#18c9a5',
    faceMid: '#0a6c58',
    faceDark: '#061f1a',
    well: '#03110e',
    line: 'rgba(200, 255, 240, 0.72)',
    ink: '#eafff8',
    spark: '#67ffd6',
    glow: 'rgba(12, 201, 163, 0.52)'
  },
  tails: {
    label: 'tails',
    letter: 'T',
    edgeDark: '#5b3505',
    edge: '#ffd97a',
    faceLight: '#e8a526',
    faceMid: '#8a5b0d',
    faceDark: '#2b1a05',
    well: '#170e02',
    line: 'rgba(255, 240, 200, 0.74)',
    ink: '#fff8e7',
    spark: '#f6c45a',
    glow: 'rgba(246, 196, 90, 0.46)'
  }
};

function ChipBase({ size = 120, side = 'heads', gradientId }) {
  const dim = typeof size === 'number' ? size : 120;
  const palette = SIDES[side] || SIDES.heads;

  return (
    <span
      className={`coin-chip coin-chip-${side}`}
      style={{ width: dim, height: dim, '--coin-glow': palette.glow }}
      role="img"
      aria-label={`${palette.label} token`}
    >
      <svg width={dim} height={dim} viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`${gradientId}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.edgeDark} />
            <stop offset="18%" stopColor={palette.edge} />
            <stop offset="38%" stopColor={palette.faceMid} />
            <stop offset="58%" stopColor={palette.edge} />
            <stop offset="78%" stopColor={palette.edgeDark} />
            <stop offset="100%" stopColor={palette.edge} />
          </linearGradient>

          <radialGradient id={`${gradientId}-face`} cx="34%" cy="26%" r="86%">
            <stop offset="0%" stopColor={palette.faceLight} />
            <stop offset="46%" stopColor={palette.faceMid} />
            <stop offset="100%" stopColor={palette.faceDark} />
          </radialGradient>

          <radialGradient id={`${gradientId}-well`} cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor={palette.faceMid} stopOpacity="0.9" />
            <stop offset="56%" stopColor={palette.well} />
            <stop offset="100%" stopColor="#010604" />
          </radialGradient>

          <linearGradient id={`${gradientId}-glint`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Contact edge: a dark silhouette under the metal keeps the token from
            floating, especially at the tiny 24px badge size. */}
        <polygon points={OUTER_12} fill="#010604" opacity="0.85" transform="translate(0 3)" />

        {/* Machined rim and struck face. */}
        <polygon points={RIM_12} fill={`url(#${gradientId}-edge)`} />
        <polygon points={FACE_12} fill={`url(#${gradientId}-face)`} stroke={palette.edge} strokeWidth="1.3" strokeOpacity="0.7" />

        {/* Radial facets. Very low contrast: they catch light only when the token
            rotates, which is exactly what sells a metal surface. */}
        {FACETS.map((point, i) => (
          <line
            key={`facet-${i}`}
            x1="120"
            y1="120"
            x2={point.x}
            y2={point.y}
            stroke="#ffffff"
            strokeOpacity={i % 2 === 0 ? '0.075' : '0.035'}
            strokeWidth="1"
          />
        ))}

        {/* Milled ticks around the rim. */}
        {TICKS.map((tick) => (
          <rect
            key={`tick-${tick}`}
            x="118.7"
            y="12.5"
            width="2.6"
            height={tick % 2 === 0 ? 8 : 5}
            rx="1.3"
            fill={palette.edge}
            opacity={tick % 2 === 0 ? 0.7 : 0.38}
            transform={`rotate(${tick * 15} 120 120)`}
          />
        ))}

        {/* Inset well. */}
        <polygon points={WELL_12} fill={`url(#${gradientId}-well)`} stroke={palette.line} strokeWidth="1.1" strokeOpacity="0.55" />
        <polygon points={WELL_12} fill="none" stroke={palette.edge} strokeWidth="0.6" strokeOpacity="0.2" transform="scale(0.9) translate(13.33 13.33)" />

        {side === 'heads' ? (
          <g opacity="0.95">
            <path d="M120 55 L127 67 L140 69 L130 79 L133 92 L120 85 L107 92 L110 79 L100 69 L113 67 Z" fill={palette.edge} opacity="0.85" />
            <circle cx="120" cy="74" r="2" fill="#03110e" opacity="0.7" />
          </g>
        ) : (
          <g opacity="0.9">
            <circle cx="120" cy="73" r="12" fill="none" stroke={palette.edge} strokeWidth="1.4" strokeDasharray="2 4" />
            <circle cx="120" cy="73" r="4" fill={palette.edge} />
          </g>
        )}

        {/* The glyph is the only thing that has to survive at 24px, so it is
            large, high-contrast and set in the display face. */}
        <text
          x="120"
          y="124"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'Space Grotesk', 'Outfit', sans-serif"
          fontSize="66"
          fontWeight="700"
          letterSpacing="-2"
          fill={palette.ink}
          stroke="#010604"
          strokeOpacity="0.32"
          strokeWidth="2.5"
          paintOrder="stroke"
        >
          {palette.letter}
        </text>

        <text
          x="120"
          y="160"
          textAnchor="middle"
          fontFamily="'Space Grotesk', 'Outfit', sans-serif"
          fontSize="8.5"
          fontWeight="600"
          letterSpacing="3.2"
          fill={palette.edge}
          opacity="0.8"
        >
          AMPCOIN
        </text>

        {/* A single specular sweep across the upper left. */}
        <path
          d="M42 96 A84 84 0 0 1 198 86"
          fill="none"
          stroke={`url(#${gradientId}-glint)`}
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.34"
        />
      </svg>
    </span>
  );
}

export function HeadsChip({ size = 120 }) {
  const gradientId = useUniqueId('heads-token');
  return <ChipBase size={size} side="heads" gradientId={gradientId} />;
}

export function TailsChip({ size = 120 }) {
  const gradientId = useUniqueId('tails-token');
  return <ChipBase size={size} side="tails" gradientId={gradientId} />;
}

export function CoinChip({ side = 'heads', size = 120 }) {
  const normalized = normalizeSide(side);
  if (normalized === 'tails') return <TailsChip size={size} />;
  return <HeadsChip size={size} />;
}

// Endless flipping coin used for loading states
export function CoinLoader({ size = 72, label }) {
  const dim = typeof size === 'number' ? size : 72;
  return (
    <div className="coin-loader" style={{ width: dim }}>
      <div className="coin-flip-scene" style={{ width: dim, height: dim }}>
        <span className="coin-flip-aura coin-flip-aura-loop" aria-hidden="true" />
        <div className="coin-flip-inner coin-loop" style={{ width: dim, height: dim }}>
          <div className="coin-face coin-face-front">
            <HeadsChip size={size} />
          </div>
          <div className="coin-face coin-face-back">
            <TailsChip size={size} />
          </div>
        </div>
      </div>
      {label && <div className="coin-loader-label">{label}</div>}
    </div>
  );
}

export function CoinFlipAnimation({ result = 'heads', size = 120, onDone }) {
  const dim = typeof size === 'number' ? size : 120;
  const normalized = normalizeSide(result);
  const isHeads = normalized === 'heads';

  // Heads: land on a multiple of 360 (5 full spins). Tails: +180 (5.5 spins).
  const landingDeg = isHeads ? 1800 : 1980;

  useEffect(() => {
    playCoinflipFlip();
  }, [normalized]);

  const handleAnimationEnd = (e) => {
    if (e.target !== e.currentTarget) return;
    playCoinflipLanding(normalized);
    if (typeof onDone === 'function') onDone(normalized);
  };

  return (
    <div
      className={`coin-flip-scene scene-${normalized}`}
      style={{ width: dim, height: dim, '--coin-size': `${dim}px` }}
    >
      {/* The token is thrown, not spun on the spot: the aura and shadow track
          the height of the arc, and the burst fires when the rim hits. */}
      <span className="coin-flip-aura" aria-hidden="true" />
      <span className="coin-flip-shadow" aria-hidden="true" />
      <div className="coin-flip-burst" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ '--spark': i }} />
        ))}
      </div>
      <div
        key={normalized}
        className={`coin-flip-inner coin-spinning ${isHeads ? 'land-heads' : 'land-tails'}`}
        style={{ width: dim, height: dim, '--coin-landing': `${landingDeg}deg` }}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="coin-face coin-face-front">
          <HeadsChip size={size} />
        </div>
        <div className="coin-face coin-face-back">
          <TailsChip size={size} />
        </div>
      </div>
      <span className="coin-flip-ring" aria-hidden="true" />
    </div>
  );
}

export default CoinChip;
