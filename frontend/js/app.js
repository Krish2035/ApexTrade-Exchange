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

        if (target === 'engine-telemetry') {
          this._refreshLiveTelemetry();
        }
      });
    });

    this._setupAuthWorkflow();
    this._setupSagaWorkflow();
  }

  _setupAuthWorkflow() {
    const modal = document.getElementById('modal-auth-backdrop');
    const openBtn = document.getElementById('btn-open-auth-modal');
    const closeBtn = document.getElementById('btn-close-auth-modal');
    const submitBtn = document.getElementById('btn-submit-auth');
    const emailInput = document.getElementById('auth-input-email');
    const passInput = document.getElementById('auth-input-password');
    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const userLabel = document.getElementById('header-user-label');

    let mode = 'LOGIN';

    if (openBtn) openBtn.onclick = () => modal.classList.add('active');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    tabLogin.onclick = () => {
      mode = 'LOGIN';
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      submitBtn.textContent = 'SIGN IN';
    };

    tabRegister.onclick = () => {
      mode = 'REGISTER';
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      submitBtn.textContent = 'CREATE ACCOUNT';
    };

    submitBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const password = passInput.value;
      const endpoint = mode === 'LOGIN' ? `${CONFIG.GATEWAY_HTTP}/auth/login` : `${CONFIG.GATEWAY_HTTP}/auth/register`;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);

        localStorage.setItem('apex_access_token', data.accessToken);
        CONFIG.USER_ID = data.user.id;
        userLabel.textContent = `${data.user.email} (${data.user.role.toUpperCase()})`;
        this.showToast(`Authenticated as ${data.user.email}`, 'success');
        modal.classList.remove('active');
        this.wallet.fetchBalances();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    };
  }

  _setupSagaWorkflow() {
    const modal = document.getElementById('modal-saga-backdrop');
    const openBtn = document.getElementById('btn-open-saga-modal');
    const closeBtn = document.getElementById('btn-close-saga-modal');
    const triggerBtn = document.getElementById('btn-trigger-saga');
    const amountInput = document.getElementById('saga-input-amount');
    const simulateFail = document.getElementById('saga-simulate-fail');
    const stepperView = document.getElementById('saga-stepper-view');
    const s1 = document.getElementById('step-1-item');
    const s2 = document.getElementById('step-2-item');
    const s3 = document.getElementById('step-3-item');
    const statusResult = document.getElementById('saga-status-result');

    if (openBtn) openBtn.onclick = () => modal.classList.add('active');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    triggerBtn.onclick = async () => {
      const amount = parseFloat(amountInput.value);
      if (!amount || amount <= 0) return this.showToast('Invalid transfer amount', 'error');

      stepperView.style.display = 'flex';
      s1.className = 'saga-step-item executing';
      s2.className = 'saga-step-item';
      s3.className = 'saga-step-item';
      statusResult.textContent = 'Executing Step 1: Reserving funds...';
      statusResult.style.color = 'var(--color-accent)';

      try {
        const res = await fetch(`${CONFIG.GATEWAY_HTTP}/sagas/withdraw`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('apex_access_token') || ''}`
          },
          body: JSON.stringify({
            userId: CONFIG.USER_ID,
            amount,
            currency: 'USD',
            simulateFailure: simulateFail.checked
          })
        });

        const data = await res.json();
        const saga = data.saga;

        if (saga.status === 'SUCCESS') {
          s1.className = 'saga-step-item completed';
          s2.className = 'saga-step-item completed';
          s3.className = 'saga-step-item completed';
          statusResult.textContent = `✔ SAGA COMPLETED: $${amount.toLocaleString()} settled to bank`;
          statusResult.style.color = 'var(--color-buy)';
          this.showToast(`Saga ${saga.id} settled successfully!`, 'success');
        } else if (saga.status === 'COMPENSATED') {
          s1.className = 'saga-step-item compensated';
          s2.className = 'saga-step-item compensated';
          s3.className = 'saga-step-item compensated';
          statusResult.textContent = `↺ SAGA COMPENSATED: Bank call failed. Funds automatically refunded (#19)`;
          statusResult.style.color = 'var(--color-sell)';
          this.showToast(`Saga Rolled Back: Compensating transaction refunded $${amount}`, 'error');
        }

        this.wallet.fetchBalances();
      } catch (err) {
        statusResult.textContent = `Error: ${err.message}`;
        statusResult.style.color = 'var(--color-sell)';
      }
    };
  }

  async _refreshLiveTelemetry() {
    const container = document.getElementById('tab-engine-telemetry');
    if (!container) return;

    try {
      const res = await fetch(`${CONFIG.GATEWAY_HTTP}/metrics/prometheus`);
      const text = await res.text();
      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: var(--color-accent);">Prometheus Live Exporter (#58, #61, #63 SLOs)</strong>
          <span style="font-size: 10px; color: var(--color-buy);">ENDPOINT: /api/v1/metrics/prometheus</span>
        </div>
        <pre style="background: var(--bg-surface-elevated); padding: 10px; border-radius: 4px; font-family: var(--font-mono); font-size: 10px; overflow-x: auto; color: #94a3b8; max-height: 140px;">${text}</pre>
      `;
    } catch (err) {
      console.warn('Telemetry fetch error:', err.message);
    }
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
