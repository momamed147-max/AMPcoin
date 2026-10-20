import React from 'react';

/**
 * The room the product sits in.
 *
 * The first version animated every layer independently: three orbs, two
 * shards, three orbit rings, sixteen twinkles, a survey line and a
 * pointer-follow spotlight. On a 1440p screen that was dozens of compositor
 * layers, several of them with 50-76px blur filters, and it was the main reason
 * the app felt heavy while nothing was happening.
 *
 * The room now keeps the same composition but almost all of it is static:
 * gradients are soft enough that they do not need a blur filter, and only the
 * aurora and the survey line move. That is enough to keep the page alive while
 * leaving the compositor free for scrolling and the coin toss.
 *
 * `aria-hidden` because none of it carries meaning, and the stars are
 * deterministic rather than random so a reload does not reshuffle the room.
 */

const STARS = [
  { x: 7, y: 22, s: 1.4, o: 0.5 },
  { x: 21, y: 34, s: 1.8, o: 0.44 },
  { x: 36, y: 12, s: 1.2, o: 0.34 },
  { x: 51, y: 84, s: 1, o: 0.3 },
  { x: 65, y: 69, s: 1.2, o: 0.34 },
  { x: 79, y: 47, s: 1.7, o: 0.38 },
  { x: 91, y: 29, s: 1.4, o: 0.48 },
  { x: 62, y: 8, s: 1.1, o: 0.4 }
];

function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-aurora" />
      <div className="ambient-beam" />
      <div className="ambient-orb ambient-orb-a" />
      <div className="ambient-orb ambient-orb-b" />
      <div className="ambient-orb ambient-orb-c" />
      <div className="ambient-shard ambient-shard-a" />
      <div className="ambient-shard ambient-shard-b" />
      <div className="ambient-rings">
        <i />
        <i />
        <i />
      </div>
      <div className="ambient-horizon" />
      <div className="ambient-grid" />
      <div className="ambient-stars">
        {STARS.map((star, index) => (
          <i
            key={index}
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.s}px`,
              height: `${star.s}px`,
              '--star-opacity': star.o
            }}
          />
        ))}
      </div>
      <div className="ambient-scan" />
      <div className="ambient-vignette" />
    </div>
  );
}

export default Ambient;
