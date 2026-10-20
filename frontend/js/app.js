import { CONFIG } from './config.js';
import { SocketClient } from './socketClient.js';
import { ChartEngine } from './chartEngine.js';
import { OrderBookWidget } from './orderBookWidget.js';
import { TradeTickerWidget } from './tradeTickerWidget.js';
import { OrderFormWidget } from './orderFormWidget.js';
import { WalletWidget } from './walletWidget.js';

/**
 * app.js
 * Terminal coordinator and state manager
 */
class ApexTradeTerminal {
  constructor() {
    this.toastStack = document.getElementById('toast-stack');
    this.connectionDot = document.getElementById('connection-status-dot');
    this.connectionText = document.getElementById('connection-status-text');
    this.latencyText = document.getElementById('gateway-latency-ms');
    this.tickerPrice = document.getElementById('ticker-current-price');
    this.openOrdersList = document.getElementById('open-orders-list');

    this.openOrders = [];

    this._init();
  }

  _init() {
    console.log('⚡ Initializing ApexTrade Real-Time Trading Terminal...');

    // 1. Initialize Chart Engine
    this.chart = new ChartEngine('candlestick-canvas');

    // 2. Initialize Order Book Widget
    this.orderBook = new OrderBookWidget('orderbook-container', (selectedPrice) => {
      this.orderForm.setPrice(selectedPrice);
    });

    // 3. Initialize Recent Trade Ticker
    this.tradesTicker = new TradeTickerWidget('recent-trades-list');

    // 4. Initialize Wallet Balances
    this.wallet = new WalletWidget('wallet-balances-list', 'header-user-balance');

    // 5. Initialize Order Form Widget
    this.orderForm = new OrderFormWidget({
      onOrderSuccess: (res) => {
        if (res.order && res.order.status === 'NEW') {
          this._addOpenOrder(res.order);
        }
        this.wallet.fetchBalances();
      },
      showToast: (msg, type) => this.showToast(msg, type)
    });

    // 6. Connect to API Gateway WebSocket
    this.socket = new SocketClient((status) => {
      this._updateConnectionStatus(status);
    });

    this._setupSocketListeners();
    this.socket.connect();
    this._setupTabSwitching();
  }

  _setupSocketListeners() {
    // Initial Snapshot
    this.socket.on('SNAPSHOT', (data) => {
      console.log('[Terminal] Received initial snapshot for', data.symbol);
      this.orderBook.update(data.depth);
      if (data.trades) {
        this.tradesTicker.setInitialTrades(data.trades);
      }
      if (data.depth && data.depth.bestAsk) {
        this._updateTickerPrice(data.depth.bestAsk);
      }
    });

    // OrderBook Depth Updates
    this.socket.on('DEPTH_UPDATE', (data) => {
      this.orderBook.update(data.depth);
    });

    // Real-Time Trade Executions
    this.socket.on('TRADES_EXECUTED', (data) => {
      if (data.trades && data.trades.length > 0) {
        this.tradesTicker.addTrades(data.trades);
        const lastTrade = data.trades[data.trades.length - 1];
        this._updateTickerPrice(lastTrade.price);
        this.chart.updateFromTrade(lastTrade);

        // Flash notification
        this.showToast(`⚡ Trade Match: ${lastTrade.amount} ${lastTrade.symbol} @ $${lastTrade.price.toLocaleString()}`, 'success');
      }

      if (data.depth) {
        this.orderBook.update(data.depth);
      }

      this.wallet.fetchBalances();
    });
  }

  _updateTickerPrice(price) {
    if (this.tickerPrice) {
      this.tickerPrice.textContent = `$${Number(price).toLocaleString()}`;
    }
  }

  _updateConnectionStatus({ connected, latency }) {
    if (connected) {
      this.connectionDot.className = 'status-dot';
      this.connectionText.textContent = 'GATEWAY ONLINE';
      this.latencyText.textContent = latency !== null ? `${latency}ms` : '--';
    } else {
      this.connectionDot.className = 'status-dot disconnected';
      this.connectionText.textContent = 'CONNECTING...';
      this.latencyText.textContent = 'ERR';
    }
  }

  _addOpenOrder(order) {
    this.openOrders.push(order);
    this._renderOpenOrders();
  }

  _renderOpenOrders() {
    if (!this.openOrdersList) return;
    if (this.openOrders.length === 0) {
      this.openOrdersList.innerHTML = `<div style="color: var(--text-muted); font-size: 11px; padding: 12px 0;">No active resting orders on book.</div>`;
      return;
    }

    this.openOrdersList.innerHTML = this.openOrders.map(o => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 11px;">
        <span style="color: ${o.side === 'BUY' ? 'var(--color-buy)' : 'var(--color-sell)'}; font-weight: 700;">${o.side}</span>
        <span>${o.symbol}</span>
        <span>Price: $${Number(o.price).toLocaleString()}</span>
        <span>Amount: ${o.amount}</span>
        <span style="color: var(--color-accent);">${o.status}</span>
        <button data-order-id="${o.id}" class="btn-cancel-ord" style="background: rgba(255,51,102,0.15); border: 1px solid var(--color-sell); color: var(--color-sell); padding: 2px 6px; border-radius: 3px; cursor: pointer;">Cancel</button>
      </div>
    `).join('');

    this.openOrdersList.querySelectorAll('.btn-cancel-ord').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-order-id');
        try {
          const res = await fetch(`${CONFIG.GATEWAY_HTTP}/orders/BTC-USD/${id}`, { method: 'DELETE' });
          if (res.ok) {
            this.openOrders = this.openOrders.filter(o => o.id !== id);
            this._renderOpenOrders();
            this.showToast(`Order ${id} cancelled`, 'success');
          }
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      });
    });
  }

  _setupTabSwitching() {
    document.querySelectorAll('.tab-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const target = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
        const activePanel = document.getElementById(`tab-${target}`);
        if (activePanel) activePanel.style.display = 'block';
      });
    });
  }

  showToast(message, type = 'info') {
    if (!this.toastStack) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✔' : type === 'error' ? '✖' : 'ℹ'}</span>
      <span>${message}</span>
    `;

    this.toastStack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.ApexTrade = new ApexTradeTerminal();
});
