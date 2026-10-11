import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import './ui-polish.css';
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

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);