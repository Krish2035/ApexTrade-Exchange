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
    const sym = symbol ? symbol.toUpperCase() : 'BTC-USD';
    let filtered = this.recentTrades.filter(t => t.symbol === sym);

    if (filtered.length === 0) {
      // Seed default recent trades for this symbol
      const prices = {
        'BTC-USD': 64550, 'ETH-USD': 3430, 'SOL-USD': 168.5, 'BNB-USD': 575,
        'XRP-USD': 0.5518, 'ADA-USD': 0.49, 'DOGE-USD': 0.1755, 'AVAX-USD': 38.99,
        'LINK-USD': 14.78, 'UNI-USD': 8.84
      };
      const base = prices[sym] || 100;
      const now = Date.now();
      for (let i = 10; i >= 1; i--) {
        const drift = (Math.random() - 0.5) * (base * 0.003);
        const price = base < 1 ? Number((base + drift).toFixed(4)) : Number((base + drift).toFixed(2));
        const amount = base > 1000 ? Number((0.1 + Math.random() * 0.5).toFixed(4)) : Number((1 + Math.random() * 20).toFixed(2));
        filtered.push({
          id: `seed-trade-${sym}-${i}`,
          symbol: sym,
          price,
          amount,
          takerSide: Math.random() > 0.5 ? 'BUY' : 'SELL',
          timestamp: now - (i * 3500)
        });
      }
      this.recentTrades.push(...filtered);
    }

    return filtered.slice(-limit).reverse();
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
