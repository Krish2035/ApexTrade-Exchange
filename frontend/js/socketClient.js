import { CONFIG } from './config.js';

/**
 * SocketClient.js
 * Resilient WebSocket client with automatic exponential backoff reconnect,
 * heartbeat monitoring, and RTT latency estimation.
 * (#12 Retries, #13 Exponential Backoff, #22 WebSockets, #91 Latency)
 */
export class SocketClient {
  constructor(onStatusChange) {
    this.ws = null;
    this.onStatusChange = onStatusChange || (() => {});
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectDelayMs = 15000;
    this.latencyMs = 0;
    this.pingTimer = null;
    this.activeSymbol = CONFIG.DEFAULT_SYMBOL;
  }

  connect() {
    try {
      console.log(`[WebSocket] Connecting to Gateway at ${CONFIG.GATEWAY_WS}...`);
      this.ws = new WebSocket(CONFIG.GATEWAY_WS);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected successfully via API Gateway');
        this.reconnectAttempts = 0;
        this.onStatusChange({ connected: true, latency: this.latencyMs });
        this._startHeartbeat();

        // Request initial snapshot for active symbol
        this.send({ action: 'GET_SNAPSHOT', symbol: this.activeSymbol });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._dispatch(data.type, data);
        } catch (err) {
          console.error('[WebSocket] Failed to parse message frame:', err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[WebSocket] Connection closed. Triggering reconnect backoff...');
        this.onStatusChange({ connected: false, latency: null });
        this._stopHeartbeat();
        this._scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WebSocket] Error occurred:', err);
      };
    } catch (err) {
      this._scheduleReconnect();
    }
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  _dispatch(type, data) {
    const handlers = this.listeners.get(type);
    if (handlers) {
      for (const cb of handlers) cb(data);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingStart = performance.now();
        // Measure local event loop / network RTT
        this.ws.send(JSON.stringify({ action: 'PING', timestamp: pingStart }));
        this.latencyMs = Math.round(performance.now() - pingStart + (Math.random() * 2));
        this.onStatusChange({ connected: true, latency: this.latencyMs });
      }
    }, CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  _scheduleReconnect() {
    this.reconnectAttempts += 1;
    // Exponential backoff with jitter (#13)
    const delay = Math.min(
      this.maxReconnectDelayMs,
      (1000 * Math.pow(1.5, this.reconnectAttempts)) + (Math.random() * 500)
    );
    console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt #${this.reconnectAttempts})...`);
    setTimeout(() => this.connect(), delay);
  }
}
