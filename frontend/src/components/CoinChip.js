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

function ChipBase({ size = 120, rim, spots, gradFrom, gradTo, letter, gradientId }) {
  const dim = typeof size === 'number' ? size : 120;
  const spotRects = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <span className="coin-chip" style={{ width: dim, height: dim }} role="img" aria-label={letter === 'H' ? 'heads chip' : 'tails chip'}>
      <svg width={dim} height={dim} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id={gradientId} cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor={gradFrom} />
            <stop offset="100%" stopColor={gradTo} />
          </radialGradient>
        </defs>

        {/* Outer rim */}
        <circle cx="100" cy="100" r="98" fill={rim} />
        <circle cx="100" cy="100" r="98" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="2" />

        {/* 8 edge spots around the rim */}
        {spotRects.map((angle) => (
          <g key={angle} transform={`rotate(${angle} 100 100)`}>
            <rect x="85" y="8" width="30" height="34" rx="7" fill={spots} />
          </g>
        ))}

        {/* White middle ring */}
        <circle cx="100" cy="100" r="70" fill="#ffffff" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="2" />

        {/* Colored center */}
        <circle cx="100" cy="100" r="54" fill={`url(#${gradientId})`} />
        <circle cx="100" cy="100" r="54" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="2" />

        {/* Subtle top gloss */}
        <ellipse cx="100" cy="72" rx="38" ry="14" fill="#ffffff" opacity="0.18" />

        {/* Letter */}
        <text
          x="100"
          y="103"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="78"
          fontWeight="900"
          fill="#ffffff"
          stroke="rgba(0,0,0,0.25)"
          strokeWidth="2"
          paintOrder="stroke"
        >
          {letter}
        </text>
      </svg>
    </span>
  );
}

export function HeadsChip({ size = 120 }) {
  const gradientId = useUniqueId('heads-grad');
  return (
    <ChipBase
      size={size}
      rim="#0a1a3a"
      spots="#e8f4ff"
      gradFrom="#4da6ff"
      gradTo="#1a66cc"
      letter="H"
      gradientId={gradientId}
    />
  );
}

export function TailsChip({ size = 120 }) {
  const gradientId = useUniqueId('tails-grad');
  return (
    <ChipBase
      size={size}
      rim="#3a1a0a"
      spots="#fff4e8"
      gradFrom="#ffab4d"
      gradTo="#cc661a"
      letter="T"
      gradientId={gradientId}
    />
  );
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
    <div className="coin-flip-scene" style={{ width: dim, height: dim }}>
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
    </div>
  );
}

export default CoinChip;
