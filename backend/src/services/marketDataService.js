import { WebSocket } from 'ws';

class MarketDataService {
  constructor() {
    this.clients = new Set();
    this.recentTrades = [];
  }

  registerClient(ws) {
    this.clients.add(ws);
    console.log(`[MarketDataService] Client connected. Total active connections: ${this.clients.size}`);

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[MarketDataService] Client disconnected. Total active: ${this.clients.size}`);
    });
  }

  recordTrades(trades) {
    if (!trades || trades.length === 0) return;
    this.recentTrades.push(...trades);
    if (this.recentTrades.length > 200) {
      this.recentTrades.splice(0, this.recentTrades.length - 200);
    }
  }

  getRecentTrades(symbol, limit = 50) {
    return this.recentTrades
      .filter(t => !symbol || t.symbol === symbol.toUpperCase())
      .slice(-limit)
      .reverse();
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  broadcastDepth(symbol, depth) {
    this.broadcast({
      type: 'DEPTH_UPDATE',
      symbol,
      depth,
      timestamp: Date.now()
    });
  }

  broadcastTrades(symbol, trades, depth) {
    this.broadcast({
      type: 'TRADES_EXECUTED',
      symbol,
      trades,
      depth,
      timestamp: Date.now()
    });
  }

  getActiveClientsCount() {
    return this.clients.size;
  }
}

export const marketDataService = new MarketDataService();
