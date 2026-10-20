import React, { useEffect, useRef } from 'react';

/**
 * The room the product sits in.
 *
 * Every screen used to be a flat sheet of navy: no depth, no light source and
 * nothing moving while a player was reading. This is a single fixed layer
 * behind the app that gives the page a horizon, three slow colour fields and a
 * pointer-follow spotlight.
 *
 * It is deliberately built from transform/opacity animation only. A blurred
 * surface being re-blurred every frame is the usual way an ambient background
 * turns a 1440p screen into a space heater; moving three pre-blurred circles
 * costs the compositor almost nothing.
 *
 * `aria-hidden` because none of it carries meaning. The stars are decorative
 * and deterministic rather than random, so a reload does not reshuffle the
 * composition and the page does not flicker on every mount.
 */

const STARS = [
  { x: 7, y: 22, s: 1.4, o: 0.5, delay: 0.2, dur: 6.4 },
  { x: 14, y: 63, s: 1, o: 0.36, delay: 1.7, dur: 8.2 },
  { x: 21, y: 34, s: 1.8, o: 0.44, delay: 3.1, dur: 7.1 },
  { x: 28, y: 78, s: 1.1, o: 0.4, delay: 0.9, dur: 9 },
  { x: 36, y: 12, s: 1.2, o: 0.34, delay: 2.4, dur: 7.7 },
  { x: 43, y: 55, s: 1.6, o: 0.4, delay: 4.2, dur: 8.6 },
  { x: 51, y: 84, s: 1, o: 0.3, delay: 1.1, dur: 6.8 },
  { x: 58, y: 27, s: 1.5, o: 0.46, delay: 3.8, dur: 7.4 },
  { x: 65, y: 69, s: 1.2, o: 0.34, delay: 0.5, dur: 9.4 },
  { x: 72, y: 17, s: 1, o: 0.42, delay: 2.9, dur: 6.2 },
  { x: 79, y: 47, s: 1.7, o: 0.38, delay: 4.8, dur: 8.1 },
  { x: 85, y: 74, s: 1.1, o: 0.32, delay: 1.4, dur: 7.9 },
  { x: 91, y: 29, s: 1.4, o: 0.48, delay: 3.5, dur: 6.7 },
  { x: 96, y: 58, s: 1, o: 0.3, delay: 0.7, dur: 9.1 },
  { x: 33, y: 91, s: 1.3, o: 0.34, delay: 5.2, dur: 8.4 },
  { x: 62, y: 8, s: 1.1, o: 0.4, delay: 2.1, dur: 7.2 }
];

function Ambient() {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    let frame = 0;
    const onMove = (event) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        node.style.setProperty('--spot-x', `${event.clientX}px`);
        node.style.setProperty('--spot-y', `${event.clientY}px`);
        node.style.setProperty('--spot-o', '1');
      });
    };
    const onLeave = () => node.style.setProperty('--spot-o', '0');

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div className="ambient" ref={ref} aria-hidden="true">
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
              '--star-opacity': star.o,
              animationDelay: `${star.delay}s`,
              animationDuration: `${star.dur}s`
            }}
          />
        ))}
      </div>
      <div className="ambient-scan" />
      <div className="ambient-spotlight" />
      <div className="ambient-noise" />
      <div className="ambient-vignette" />
    </div>
  );
}

export default Ambient;
