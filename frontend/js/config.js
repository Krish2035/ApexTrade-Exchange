/**
 * config.js
 * ApexTrade Gateway Connection Configuration
 * The Frontend communicates ONLY with the API Gateway on port 8080.
 * (#4 Reverse Proxies, #5 API Gateways)
 */
export const CONFIG = {
  GATEWAY_HTTP: 'http://localhost:8080/api/v1',
  GATEWAY_WS: 'ws://localhost:8080/ws',
  DEFAULT_SYMBOL: 'BTC-USD',
  USER_ID: 'trader-alice',
  HEARTBEAT_INTERVAL_MS: 3000
};
