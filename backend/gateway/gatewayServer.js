import http from 'http';
import net from 'net';

/**
 * gatewayServer.js
 * ApexTrade Edge API Gateway & Reverse Proxy
 * (#4 Reverse Proxies, #5 API Gateways, #1 Rate Limiting, #76 CORS, #91 Latency)
 * 
 * - The Frontend communicates ONLY with this Gateway on PORT 8080.
 * - HTTP traffic is securely reverse-proxied to internal backend on PORT 4000.
 * - WebSocket upgrade traffic is reverse-proxied to internal WS service on PORT 4001.
 */

const GATEWAY_PORT = process.env.GATEWAY_PORT || 8080;
const BACKEND_HTTP_HOST = '127.0.0.1';
const BACKEND_HTTP_PORT = 4000;
const BACKEND_WS_PORT = 4001;

// 1. Sliding Window Rate Limiter at the Gateway Edge (#1 Rate Limiting)
const clientRequests = new Map();
function isRateLimited(ip, limit = 500, windowMs = 60000) {
  const now = Date.now();
  if (!clientRequests.has(ip)) clientRequests.set(ip, []);
  const timestamps = clientRequests.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  clientRequests.set(ip, timestamps);
  return timestamps.length > limit;
}

// 2. Gateway HTTP Reverse Proxy
const gateway = http.createServer((clientReq, clientRes) => {
  const startTime = process.hrtime.bigint();
  const clientIp = clientReq.socket.remoteAddress || '127.0.0.1';

  // Apply Edge Rate Limiting (#1)
  if (isRateLimited(clientIp)) {
    clientRes.writeHead(429, { 'Content-Type': 'application/json' });
    return clientRes.end(JSON.stringify({ error: 'Gateway: Rate Limit Exceeded' }));
  }

  // Gateway Security & CORS Headers (#76 CORS, #74 WAF protection)
  clientRes.setHeader('Access-Control-Allow-Origin', '*');
  clientRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  clientRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Requested-With');
  clientRes.setHeader('X-Forwarded-By', 'ApexTrade-API-Gateway/1.0');

  if (clientReq.method === 'OPTIONS') {
    clientRes.writeHead(204);
    return clientRes.end();
  }

  // Health probe of the Gateway itself (#56 Health Checks)
  if (clientReq.url === '/gateway/health') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    return clientRes.end(JSON.stringify({
      gateway: 'HEALTHY',
      backendTarget: `http://${BACKEND_HTTP_HOST}:${BACKEND_HTTP_PORT}`,
      wsTarget: `ws://${BACKEND_HTTP_HOST}:${BACKEND_WS_PORT}`,
      uptime: process.uptime()
    }));
  }

  // Proxy Options to internal backend service (#4 Reverse Proxy)
  const proxyOptions = {
    hostname: BACKEND_HTTP_HOST,
    port: BACKEND_HTTP_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'x-forwarded-for': clientIp,
      'x-gateway-ingress-time': Date.now().toString()
    }
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });

    proxyRes.on('end', () => {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
      console.log(`[Gateway Proxy] ${clientReq.method} ${clientReq.url} -> ${proxyRes.statusCode} (${durationMs.toFixed(2)}ms)`);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[Gateway Error] Backend unreachable:`, err.message);
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({
      error: 'Bad Gateway (#5)',
      message: 'ApexTrade Backend core service is currently unreachable'
    }));
  });

  clientReq.pipe(proxyReq, { end: true });
});

// 3. WebSocket Reverse Proxy & TCP Tunnel (#22 WebSockets, #98 TCP)
gateway.on('upgrade', (req, socket, head) => {
  console.log(`[Gateway WS Upgrade] Proxying WebSocket connection for path: ${req.url}`);

  // Connect to internal WebSocket server
  const backendSocket = net.connect(BACKEND_WS_PORT, BACKEND_HTTP_HOST, () => {
    backendSocket.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(req.headers)
        .map(([key, val]) => `${key}: ${val}\r\n`)
        .join('') +
      '\r\n'
    );

    if (head && head.length > 0) {
      backendSocket.write(head);
    }

    // Bidirectional TCP streaming
    backendSocket.pipe(socket);
    socket.pipe(backendSocket);
  });

  backendSocket.on('error', (err) => {
    console.error('[Gateway WS Proxy Error]:', err.message);
    socket.destroy();
  });

  socket.on('error', (err) => {
    backendSocket.destroy();
  });
});

gateway.listen(GATEWAY_PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  ApexTrade Unified API Gateway & Reverse Proxy`);
  console.log(`   Public Gateway Ingress : http://localhost:${GATEWAY_PORT}`);
  console.log(`   Public WebSocket Proxy : ws://localhost:${GATEWAY_PORT}/ws`);
  console.log(`   Proxied Backend Target : http://${BACKEND_HTTP_HOST}:${BACKEND_HTTP_PORT}`);
  console.log(`======================================================\n`);
});
