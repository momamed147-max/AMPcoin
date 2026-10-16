import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import './ui-polish.css';
// Presentation polish. Sits before the V2/V3 layers: every rule in it is scoped
// under .app so it outranks the shared layers by specificity rather than by
// relying on import order, which keeps v3.css last as the palette authority.
import './ui/polish.css';
// Motion layer. Targets the shared primitives rather than individual pages, so
// one stylesheet moves every control in the site. Imported after polish.css so
// its hover lifts and presses win.
import './ui/motion.css';
import './theme.css';
// The V2 design layer goes last on purpose. theme.css must win over the token
// defaults so a theme can repaint the primitives, and ui.css must sit after
// tokens.css because every rule in it reads those custom properties.
import './ui/tokens.css';
import './ui/ui.css';
// The always-on chrome: background, scrollbars, focus, panel surfaces. Loaded
// last so it settles everything the shared layers above it left open.
import './ui/shell.css';
// v3: the visual language. Palette, elevation, type scale, controls and
// surfaces, redefined site-wide. Loaded last of all so it wins over every
// older stylesheet while themes still override the colour variables.
import './ui/v3.css';

// Surface and depth. This one is imported LAST, on purpose.
//
// It restyles the panel and action primitives that every other sheet also
// styles, so load order decides the winner. Imported anywhere earlier and
// ui/shell.css plus ui/v3.css both land on top of it and discard it - which
// is exactly what happened, and why none of it was visible on the site.
//
// A theme still overrides it: a theme repaints the custom properties this
// layer reads, not the rules themselves.
// Surface and depth. Imported LAST, on purpose.
//
// It restyles the panel and action primitives that every other sheet also
// styles, so load order decides the winner. Imported anywhere earlier and
// ui/shell.css plus ui/v3.css both land on top of it and discard it - which is
// what happened, and why none of it was visible on the site.
//
// A theme still overrides it: a theme repaints the custom properties this
// layer reads, not the rules themselves.
import './ui/surface.css';
  // Layout. Last of all: it re-grids the lobby rows and re-measures the page
  // column, which are structural rather than cosmetic, and it needs to beat the
  // flex definitions in lobby.css to do it.
  import './ui/layout.css';
  // Shared page layout. Fixes the problems that repeat across pages - a
  // duplicated title, empty panels reserving 400px, items floating in
  // oversized boxes - once, rather than page by page.
  import './ui/page-layout.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);