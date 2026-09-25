const configuredApiUrl = String(
  process.env.REACT_APP_API_URL || 'http://localhost:5000'
).trim();

// Keep route concatenation predictable even when the deployment variable is
// entered with one or more trailing slashes (for example, Railway URLs).
export const API_BASE = configuredApiUrl.replace(/\/+$/, '');

export default API_BASE;
