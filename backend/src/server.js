import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { OrderBook } from './core/orderbook/OrderBook.js';
import { Order } from './core/orderbook/Order.js';
import { DoubleEntryLedger } from './core/ledger/DoubleEntryLedger.js';
import { Account } from './core/ledger/Account.js';
import { DistributedLock } from './core/locks/DistributedLock.js';
import { IdempotencyStore } from './core/idempotency/IdempotencyStore.js';

const PORT = process.env.PORT || 4000;
const WS_PORT = process.env.WS_PORT || 4001;

// 1. Initialize Core Engines
const books = new Map();
books.set('BTC-USD', new OrderBook('BTC-USD'));
books.set('ETH-USD', new OrderBook('ETH-USD'));

const ledger = new DoubleEntryLedger();
const lockManager = new DistributedLock();
const idempotencyStore = new IdempotencyStore();

// Seed initial system liquidity accounts
const systemFeeAccount = ledger.registerAccount(new Account({
  id: 'acc-fee-vault',
  userId: 'system-treasury',
  currency: 'USD',
  type: 'EQUITY',
  initialBalance: 0
}));

// Seed demo users and wallets
const demoUsers = ['trader-alice', 'trader-bob'];
for (const u of demoUsers) {
  ledger.registerAccount(new Account({
    id: `acc-${u}-usd`,
    userId: u,
    currency: 'USD',
    type: 'ASSET',
    initialBalance: 100000 // $100,000 USD
  }));
  ledger.registerAccount(new Account({
    id: `acc-${u}-btc`,
    userId: u,
    currency: 'BTC',
    type: 'ASSET',
    initialBalance: 10 // 10 BTC
  }));
}

// Seed initial orderbook liquidity
const btcBook = books.get('BTC-USD');
const baseBtcPrice = 64250;
for (let i = 1; i <= 15; i++) {
  btcBook.processOrder(new Order({
    id: `seed-bid-${i}`,
    userId: 'market-maker-1',
    symbol: 'BTC-USD',
    side: 'BUY',
    type: 'LIMIT',
    price: baseBtcPrice - (i * 25),
    amount: (0.5 + (i * 0.2))
  }));

  btcBook.processOrder(new Order({
    id: `seed-ask-${i}`,
    userId: 'market-maker-2',
    symbol: 'BTC-USD',
    side: 'SELL',
    type: 'LIMIT',
    price: baseBtcPrice + (i * 25),
    amount: (0.5 + (i * 0.2))
  }));
}

// 2. Sliding Window Rate Limiter (#1 Rate Limiting)
const rateLimits = new Map(); // ip -> [timestamps]
function checkRateLimit(ip, limit = 120, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  const timestamps = rateLimits.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimits.set(ip, timestamps);
  return timestamps.length <= limit;
}

// 3. High-Performance WebSocket Server (#22 WebSockets, #16 Pub/Sub)
const wss = new WebSocketServer({ port: WS_PORT });
const recentTrades = [];

wss.on('connection', (ws) => {
  console.log(`[WebSocket] Client connected. Total clients: ${wss.clients.size}`);
  
  // Send initial depth snapshot
  const initialSnapshot = {
    type: 'SNAPSHOT',
    symbol: 'BTC-USD',
    depth: btcBook.getL2Depth(20),
    trades: recentTrades.slice(-20)
  };
  ws.send(JSON.stringify(initialSnapshot));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.action === 'SUBSCRIBE' && books.has(data.symbol)) {
        ws.subscribedSymbol = data.symbol;
      }
    } catch (err) {
      // Ignore malformed ping/frames
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Client disconnected. Total: ${wss.clients.size}`);
  });
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// 4. HTTP API Server
const server = http.createServer(async (req, res) => {
  const reqStart = process.hrtime.bigint();
  const clientIp = req.socket.remoteAddress || '127.0.0.1';

  // Apply Rate Limiting (#1)
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Too Many Requests (Rate Limit Exceeded)' }));
  }

  // CORS Headers (#76 CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Helper to parse JSON body
  const parseJsonBody = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });

  try {
    // ------------------------------------------------------------------------
    // GET /api/v1/health (#56 Health Checks, #57 Liveness Probe)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptimeSeconds: process.uptime(),
        memoryUsage: process.memoryUsage(),
        version: '1.0.0'
      }));
    }

    // ------------------------------------------------------------------------
    // GET /api/v1/metrics (#61 Metrics, #63 SLOs)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        activeWebSockets: wss.clients.size,
        totalJournals: ledger.journals.length,
        symbols: Array.from(books.keys()).map(s => ({
          symbol: s,
          sequence: books.get(s).sequence.toString(),
          ordersInBook: books.get(s).orders.size
        }))
      }));
    }

    // ------------------------------------------------------------------------
    // GET /api/v1/orderbook/:symbol
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/orderbook/')) {
      const symbol = url.pathname.replace('/api/v1/orderbook/', '').toUpperCase();
      const book = books.get(symbol);
      if (!book) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Symbol not found: ${symbol}` }));
      }

      const depth = book.getL2Depth(30);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(depth));
    }

    // ------------------------------------------------------------------------
    // POST /api/v1/orders (Place Order with #14 Idempotency & #38 Lock)
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/v1/orders') {
      const idempotencyKey = req.headers['idempotency-key'] || null;

      // Handle Idempotency (#14)
      if (idempotencyKey) {
        const idempCheck = idempotencyStore.start(idempotencyKey);
        if (!idempCheck.proceed) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache-Lookup': 'HIT' });
          return res.end(JSON.stringify(idempCheck.cachedResponse));
        }
      }

      const body = await parseJsonBody();
      const { userId = 'trader-alice', symbol = 'BTC-USD', side, type, price, amount } = body;

      const book = books.get(symbol);
      if (!book) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Unsupported symbol ${symbol}` }));
      }

      // Safe execution under distributed user lock (#38, #39)
      const orderResult = await lockManager.withLock(`user-lock:${userId}`, async () => {
        const orderId = `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const order = new Order({
          id: orderId,
          userId,
          symbol,
          side,
          type,
          price: Number(price) || 0,
          amount: Number(amount),
          idempotencyKey
        });

        const { trades, remainingOrder } = book.processOrder(order);

        // Record recent trades
        if (trades.length > 0) {
          recentTrades.push(...trades);
          if (recentTrades.length > 200) recentTrades.splice(0, recentTrades.length - 200);

          // Broadcast real-time execution tick via WebSocket
          broadcast({
            type: 'TRADES_EXECUTED',
            symbol,
            trades,
            depth: book.getL2Depth(20)
          });
        } else {
          // Broadcast depth update for resting limit order
          broadcast({
            type: 'DEPTH_UPDATE',
            symbol,
            depth: book.getL2Depth(20)
          });
        }

        return {
          order: {
            id: remainingOrder.id,
            symbol: remainingOrder.symbol,
            side: remainingOrder.side,
            type: remainingOrder.type,
            price: remainingOrder.price,
            amount: remainingOrder.amount,
            filled: remainingOrder.filled,
            remaining: remainingOrder.remaining,
            status: remainingOrder.status
          },
          tradesCount: trades.length,
          trades
        };
      });

      if (idempotencyKey) {
        idempotencyStore.resolve(idempotencyKey, orderResult);
      }

      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(orderResult));
    }

    // 404 Fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint Not Found' }));

  } catch (err) {
    console.error(`[Error] Request failed: ${err.message}`, err.stack);
    res.writeHead(err.message.includes('Conflict') ? 409 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  } finally {
    const reqEnd = process.hrtime.bigint();
    const durationMs = Number(reqEnd - reqStart) / 1e6;
    console.log(`[HTTP] ${req.method} ${url.pathname} - ${res.statusCode} (${durationMs.toFixed(2)}ms)`);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🔥 ApexTrade Core Engine & API Gateway`);
  console.log(`   HTTP API       : http://localhost:${PORT}`);
  console.log(`   WebSocket Feed : ws://localhost:${WS_PORT}`);
  console.log(`   Health Check   : http://localhost:${PORT}/api/v1/health`);
  console.log(`   L2 Depth Feed  : http://localhost:${PORT}/api/v1/orderbook/BTC-USD`);
  console.log(`======================================================\n`);
});
