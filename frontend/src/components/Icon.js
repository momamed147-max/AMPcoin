import React from 'react';

/* Central SVG icon set — replaces all emojis site-wide.
 * Usage: <Icon name="diamond" size={14} className="..." />
 * Icons inherit text color via currentColor.
 */
const PATHS = {
  coin: (<g><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.2 9.8c0-1 1.2-1.8 2.8-1.8s2.8.8 2.8 1.8-1 1.6-2.8 2-2.8 1-2.8 2 1.2 1.8 2.8 1.8s2.8-.8 2.8-1.8" /></g>),
  jackpot: (<g><rect x="3" y="7" width="18" height="12" rx="2.5" /><path d="M3 11h18M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M12 12.2v.1M8.5 14.5v.1M15.5 14.5v.1" /><circle cx="12" cy="14.5" r="1.1" /></g>),
  eye: (<g><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></g>),
  diamond: (<g><path d="M7 3.5h10l3.5 5-8.5 12-8.5-12Z" /><path d="M3.5 8.5h17M9.5 8.5 12 20.5 14.5 8.5M7 3.5l2.5 5M17 3.5l-2.5 5" /></g>),
  trophy: (<g><path d="M8 4h8v5a4 4 0 0 1-8 0Z" /><path d="M8 5H4.5a.5.5 0 0 0-.5.5C4 8 6 10 8.5 10M16 5h3.5a.5.5 0 0 1 .5.5c0 2.5-2 4.5-4.5 4.5M12 13v4M8.5 20.5h7M10 17h4" /></g>),
  chart: (<g><path d="M4 4v15.5a.5.5 0 0 0 .5.5H20" /><path d="M8 15v-4M12.5 15V8M17 15v-6.5" /></g>),
  gear: (<g><circle cx="12" cy="12" r="3.2" /><path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.39 2.54a7 7 0 0 0-2.42 1.4l-2.35-.95-2 3.46 2 1.55a7 7 0 0 0 0 2.8l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.42 1.4l.39 2.54h3.4l.39-2.54a7 7 0 0 0 2.42-1.4l2.35.95 2-3.46-2-1.55c.1-.46.14-.93.14-1.4Z" /></g>),
  wallet: (<g><path d="M20 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z" /><path d="M3 7V6a2 2 0 0 1 2-2h14" /><circle cx="16.8" cy="13.5" r="1.2" /></g>),
  gift: (<g><rect x="4" y="9" width="16" height="4" /><path d="M5.5 13v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7M12 9v12M12 9S7 9 5.5 7.5 6.5 4.5 8 5c1.8.6 4 4 4 4ZM12 9s5 0 6.5-1.5S17.5 4.5 16 5c-1.8.6-4 4-4 4Z" /></g>),
  bell: (<g><path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14.5 6 9.5" /><path d="M10 19.5a2.2 2.2 0 0 0 4 0" /></g>),
  chat: (<g><path d="M21 12a8 8 0 0 1-8 8H4l1.5-3.2A8 8 0 1 1 21 12Z" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" /></g>),
  search: (<g><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></g>),
  close: (<g><path d="M6 6l12 12M18 6 6 18" /></g>),
  dice: (<g><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9.2 9.2h.01M14.8 9.2h.01M12 12h.01M9.2 14.8h.01M14.8 14.8h.01" /></g>),
  history: (<g><path d="M4.5 8A8.5 8.5 0 1 1 3.6 14" /><path d="M4.5 3.5V8H9M12 8v4.5l3 1.8" /></g>),
  shield: (<g><path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.6 7 9.3 4.1-1.7 7-4.9 7-9.3V5.8Z" /><path d="m9.3 11.8 2 2 3.4-3.8" /></g>),
  plus: (<g><path d="M12 5v14M5 12h14" /></g>),
  check: (<g><path d="m5 12.5 4.5 4.5L19 7.5" /></g>),
  lock: (<g><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></g>),
  party: (<g><path d="M5 15 15 5M14 4l-2-.8L10.5 5 12 6.5 13.5 5 14 4ZM16.5 6.5 18 5l.8 2L17 8.5 15.5 7l1-1.5ZM13 9l-1.5 1L13 11.5 14.5 10 13 9Z" /><path d="M5 15c-1 4-1 5-1 5s1 0 5-1M7 13.5c.5 2 1.5 3.5 1.5 3.5M4 4l3 1-1 3-3-1Z" /></g>),
  wave: (<g><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V11m0-3a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-.8a6 6 0 0 1-4.9-2.5L2.5 15a1.6 1.6 0 0 1 2.6-1.8L7 15.5" /></g>),
  cash: (<g><rect x="3" y="6.5" width="18" height="11" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 10.5h.01M17.5 13.5h.01" /></g>),
  box: (<g><path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2Z" /><path d="M4.3 7.4 12 11.5l7.7-4.1M12 11.5V21" /></g>),
  fire: (<g><path d="M12 21.5c-4 0-6.5-2.6-6.5-6 0-2.5 1.4-4.4 2.6-6C9.4 7.9 10.5 6.5 10.5 4c3 2 4.3 4.2 4.9 6.4.7-.4 1.3-1 1.7-1.9 1.5 1.6 2.4 3.7 2.4 6 0 3.4-2.5 7-7.5 7Z" /><path d="M12 21.5c-2 0-3.4-1.3-3.4-3 0-1.3.7-2.3 1.4-3.1.7-.9 1.3-1.6 1.3-2.9 1.6 1 2.3 2.2 2.6 3.4.4-.2.7-.5 1-1 .8.9 1.3 2 1.3 3.2 0 2-1.4 3.4-4.2 3.4Z" /></g>),
  door: (<g><path d="M13 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7" /><path d="M13 4l6 2v12l-6 2M13 4v16M16 12h.01" /></g>),
  board: (<g><rect x="5" y="4.5" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5M9 10.5h6M9 14h6M9 17.5h3.5" /></g>),
  refresh: (<g><path d="M20 12a8 8 0 1 1-2.3-5.6M20 3.5V8h-4.5" /></g>),
  flag: (<g><path d="M6 21V4M6 4.5h11.5l-2.5 4 2.5 4H6" /></g>),
  shop: (<g><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M9.5 20v-6h5v6" /></g>),
  bag: (<g><path d="M6.5 8h11l1 12.5h-13Z" /><path d="M9 10.5V6.5a3 3 0 0 1 6 0v4" /></g>),
  send: (<g><path d="M21 3.5 10.5 14M21 3.5 14 21l-3.5-7L3 10.5Z" /></g>),
  warn: (<g><path d="M12 3.5 22 20H2Z" /><path d="M12 9.5v4.5M12 17.2v.1" /></g>),
  settings: (<g><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></g>),
  target: (<g><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></g>),
  chevron: (<g><path d="m8.5 10 3.5 3.5 3.5-3.5" /></g>),
  arrowRight: (<g><path d="M5 12h14M14 7l5 5-5 5" /></g>),
  info: (<g><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></g>),
  sort: (<g><path d="m8 7 4-4 4 4M12 3v18M16 17l-4 4-4-4" /></g>),
  volume: (<g><path d="M5 10v4h3l4 3V7L8 10H5Z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" /></g>),
  volumeOff: (<g><path d="M5 10v4h3l4 3V7L8 10H5Z" /><path d="m16 10 4 4M20 10l-4 4" /></g>),
  dot: (<g><circle cx="12" cy="12" r="4" /></g>)
};

const Icon = ({ name, size = 16, className = '', style = {} }) => (
  <svg
    className={`amp-icon amp-icon-${name} ${className}`.trim()}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, verticalAlign: 'middle', ...style }}
    aria-hidden="true"
  >
    {PATHS[name] || PATHS.dot}
  </svg>
);

export default Icon;
