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

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);