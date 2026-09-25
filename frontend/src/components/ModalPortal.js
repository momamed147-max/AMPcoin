import { createPortal } from 'react-dom';

// Renders modal overlays straight to <body> so no ancestor layout,
// transform, filter, or animation can trap or clip them.
const ModalPortal = ({ children }) => createPortal(children, document.body);

export default ModalPortal;
