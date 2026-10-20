import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// -- Stylesheet load order, and why it is what it is ------------------------
//
// This list is load-bearing. Changing it changes what the product looks like.
//
// 1. ui/system.css    The design system. Every token in the product is
//                     declared here and nowhere else. First, so the other
//                     44 stylesheets have something to read.
//
// 2. index.css        Document reset, immediately after the system so it can
//                     use its tokens.
//
// 3. theme.css        A theme repaints primitives through
//                     :root[data-theme=x], which outranks the system's :root.
//                     Intentional - picking a theme still has to work.
//
// 4. everything else  Legacy polish, the primitive set, chrome, and the
//                     component library. All of it reads tokens.
//
// One constraint is not visible from this file: a stylesheet imported by a
// lazily loaded page is injected after the whole main bundle, so it beats
// anything listed here no matter where it sits. Per-page sheets therefore own
// their own appearance, and only page-independent primitives belong in this
// chain.
//
// 5. ui/components.css The primitives the whole product is built from:
//                     panels, buttons, tabs, modals, badges, tables and
//                     empty states. Last of the global layers so it wins the
//                     components the legacy sheets above also style.
import './ui/system.css';
import './index.css';
import './ui-polish.css';
import './ui/polish.css';
import './ui/motion.css';
import './theme.css';
import './ui/ui.css';
import './ui/shell.css';
import './ui/v3.css';
import './ui/components.css';
// 6. ui/prestige.css The premium visual and motion layer. Last, so it can
//                     deepen the shared shell and primitives without touching
//                     markup or page logic. Page chunks still load after it,
//                     which is why page-specific overrides repeat their
//                     selectors there rather than being fought from here.
import './ui/prestige.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);