/**
 * config.js
 * ApexTrade Gateway Connection Configuration
 * - Localhost: Connects to local gateway/backend.
 * - Production (Vercel): Connects to Render backend.
 */
const isLocal = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.port === '3000'
);

// Default Render URL (Can also be overridden in browser console or via window.__APEX_BACKEND_URL__)
const PROD_BACKEND_URL = (typeof window !== 'undefined' && (window.__APEX_BACKEND_URL__ || localStorage.getItem('APEX_BACKEND_URL'))) || 'https://apextrade-exchange-u3y1.onrender.com';
const PROD_WS_URL = PROD_BACKEND_URL.replace(/^http/, 'ws');

export const CONFIG = {
  GATEWAY_HTTP: isLocal ? 'http://localhost:8080/api/v1' : `${PROD_BACKEND_URL}/api/v1`,
  GATEWAY_WS: isLocal ? 'ws://localhost:8080/ws' : `${PROD_WS_URL}`,
  DEFAULT_SYMBOL: 'BTC-USD',
  USER_ID: 'trader-alice',
  HEARTBEAT_INTERVAL_MS: 3000
};
