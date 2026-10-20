import http from 'http';
import { WebSocketServer } from 'ws';
import app from './app.js';
import { marketDataService } from './services/marketDataService.js';
import { matchingEngineService } from './services/matchingEngineService.js';

const PORT = process.env.PORT || 4000;
const WS_PORT = process.env.WS_PORT || 4001;

// 1. Create Internal HTTP Server
const httpServer = http.createServer(app);

// 2. Create Internal WebSocket Server
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  marketDataService.registerClient(ws);

  // Send initial depth snapshot on connection
  try {
    const btcDepth = matchingEngineService.getL2Depth('BTC-USD', 20);
    const recent = marketDataService.getRecentTrades('BTC-USD', 20);
    ws.send(JSON.stringify({
      type: 'SNAPSHOT',
      symbol: 'BTC-USD',
      depth: btcDepth,
      trades: recent
    }));
  } catch (err) {
    console.error('[WebSocket] Error sending snapshot:', err.message);
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'GET_SNAPSHOT' && msg.symbol) {
        const depth = matchingEngineService.getL2Depth(msg.symbol, 20);
        const trades = marketDataService.getRecentTrades(msg.symbol, 20);
        ws.send(JSON.stringify({
          type: 'SNAPSHOT',
          symbol: msg.symbol,
          depth,
          trades
        }));
      }
    } catch (err) {
      // Ignore invalid frames
    }
  });
});

import { authServiceV2 } from './core/auth/AuthServiceV2.js';
import db from './core/db/database.js';

// Seed default institutional accounts and users in SQLite WAL store
try {
  authServiceV2.seedDefaultUsers();
  console.log(`[Persistence] SQLite WAL database initialized. Schema tables verified.`);
} catch (err) {
  console.warn('[Persistence] Seeding warning:', err.message);
}

httpServer.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🔥 ApexTrade Core Backend Service Running`);
  console.log(`   Internal REST API : http://127.0.0.1:${PORT}/api/v1`);
  console.log(`   Internal WS Feed  : ws://127.0.0.1:${WS_PORT}`);
  console.log(`   Persistence Layer : SQLite (WAL mode, crash-safe)`);
  console.log(`   Auth Engine       : HS512 JWT + Refresh Token Rotation`);
  console.log(`   Payment Rails     : Stripe, Crypto Mempool, Wire`);
  console.log(`   Compliance        : Tiered KYC & Real-time AML`);
  console.log(`======================================================\n`);
});

export { httpServer, wss };
