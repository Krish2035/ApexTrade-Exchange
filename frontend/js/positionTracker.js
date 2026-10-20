/**
 * positionTracker.js
 * Real-time Position & P&L management widget.
 * Shows open positions, unrealized PnL, liquidation prices, margin usage.
 */
export class PositionTracker {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.positions = [
      {
        id: 'pos-001',
        symbol: 'BTC-USD',
        side: 'LONG',
        size: 0.5,
        entryPrice: 63100.00,
        currentPrice: 64250.00,
        leverage: 10,
        liquidationPrice: 56790.00,
        margin: 3155.00,
        unrealizedPnl: 575.00,
        unrealizedPnlPct: 18.22,
        openedAt: Date.now() - 3600000
      },
      {
        id: 'pos-002',
        symbol: 'ETH-USD',
        side: 'SHORT',
        size: 2.0,
        entryPrice: 3900.00,
        currentPrice: 3842.50,
        leverage: 5,
        liquidationPrice: 4290.00,
        margin: 1560.00,
        unrealizedPnl: 115.00,
        unrealizedPnlPct: 7.37,
        openedAt: Date.now() - 7200000
      }
    ];
    this.totalUnrealizedPnl = 690.00;
    this._render();
    this._startPnlUpdater();
  }

  _render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="positions-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">Open Positions</span>
          <span class="position-count-badge" id="pos-count-badge">${this.positions.length}</span>
        </div>
        <div style="font-size:11px;">
          <span style="color:var(--text-muted);">Total Unrealized P&L:</span>
          <span id="total-unrealized-pnl" style="font-weight:700;margin-left:6px;color:var(--color-buy);">+$${this.totalUnrealizedPnl.toFixed(2)}</span>
        </div>
      </div>

      <div class="positions-table">
        <div class="positions-table-head">
          <span>Symbol</span>
          <span>Side</span>
          <span>Size</span>
          <span>Entry</span>
          <span>Mark</span>
          <span>Liq. Price</span>
          <span>Margin</span>
          <span>Unr. PnL</span>
          <span>Actions</span>
        </div>
        <div id="positions-rows">
          ${this.positions.map(p => this._renderPosition(p)).join('')}
        </div>
      </div>

      <div class="margin-usage-bar-wrapper">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:10px;color:var(--text-muted);">
          <span>MARGIN USAGE</span>
          <span id="margin-usage-pct">4.7%</span>
        </div>
        <div class="margin-usage-track">
          <div class="margin-usage-fill" id="margin-usage-fill" style="width:4.7%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--text-muted);">
          <span>Available: <span style="color:var(--color-buy);font-weight:700;">$95,285.00</span></span>
          <span>Total Margin: <span style="color:var(--color-accent);font-weight:700;">$4,715.00</span></span>
        </div>
      </div>
    `;

    this._bindActions();
  }

  _renderPosition(p) {
    const isLong = p.side === 'LONG';
    const sideColor = isLong ? 'var(--color-buy)' : 'var(--color-sell)';
    const pnlColor = p.unrealizedPnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)';
    const pnlSign = p.unrealizedPnl >= 0 ? '+' : '';
    const duration = this._formatDuration(Date.now() - p.openedAt);

    return `
      <div class="position-row" id="pos-row-${p.id}">
        <span class="pos-symbol">${p.symbol}</span>
        <span class="pos-side" style="color:${sideColor};">
          <span class="side-pill" style="background:${isLong ? 'rgba(0,230,118,0.15)' : 'rgba(255,51,102,0.15)'};">${p.side} ${p.leverage}x</span>
        </span>
        <span class="pos-data">${p.size} BTC</span>
        <span class="pos-data">$${p.entryPrice.toLocaleString()}</span>
        <span class="pos-data pos-mark-price" id="pos-mark-${p.id}">$${p.currentPrice.toLocaleString()}</span>
        <span class="pos-data" style="color:var(--color-sell);">$${p.liquidationPrice.toLocaleString()}</span>
        <span class="pos-data">$${p.margin.toFixed(2)}</span>
        <span class="pos-pnl" style="color:${pnlColor};" id="pos-pnl-${p.id}">
          ${pnlSign}$${p.unrealizedPnl.toFixed(2)}
          <span style="font-size:10px;opacity:0.7;">(${pnlSign}${p.unrealizedPnlPct.toFixed(2)}%)</span>
        </span>
        <div class="pos-actions">
          <button class="pos-tp-btn" data-id="${p.id}" title="Set Take Profit / Stop Loss">TP/SL</button>
          <button class="pos-close-btn" data-id="${p.id}">Close</button>
        </div>
      </div>
    `;
  }

  _formatDuration(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  _bindActions() {
    document.querySelectorAll('.pos-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        this.positions = this.positions.filter(p => p.id !== id);
        document.getElementById(`pos-row-${id}`)?.remove();
        this._updateTotalPnl();
        window.dispatchEvent(new CustomEvent('toast:show', { detail: { msg: `Position ${id} closed.`, type: 'success' } }));
      });
    });

    document.querySelectorAll('.pos-tp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        window.dispatchEvent(new CustomEvent('modal:tpsl', { detail: { positionId: id } }));
      });
    });
  }

  _updateTotalPnl() {
    this.totalUnrealizedPnl = this.positions.reduce((acc, p) => acc + p.unrealizedPnl, 0);
    const el = document.getElementById('total-unrealized-pnl');
    const badge = document.getElementById('pos-count-badge');
    if (el) {
      const sign = this.totalUnrealizedPnl >= 0 ? '+' : '';
      el.textContent = `${sign}$${this.totalUnrealizedPnl.toFixed(2)}`;
      el.style.color = this.totalUnrealizedPnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)';
    }
    if (badge) badge.textContent = this.positions.length;
  }

  _startPnlUpdater() {
    setInterval(() => {
      this.positions.forEach(p => {
        // Simulate mark price movement
        const tick = (Math.random() - 0.49) * (p.currentPrice * 0.0005);
        p.currentPrice += tick;
        const rawPnl = p.side === 'LONG'
          ? (p.currentPrice - p.entryPrice) * p.size
          : (p.entryPrice - p.currentPrice) * p.size;
        p.unrealizedPnl = rawPnl * p.leverage;
        p.unrealizedPnlPct = (rawPnl / p.entryPrice) * p.leverage * 100;

        // Update DOM
        const markEl = document.getElementById(`pos-mark-${p.id}`);
        const pnlEl  = document.getElementById(`pos-pnl-${p.id}`);
        if (markEl) markEl.textContent = `$${p.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (pnlEl) {
          const sign = p.unrealizedPnl >= 0 ? '+' : '';
          pnlEl.innerHTML = `${sign}$${p.unrealizedPnl.toFixed(2)} <span style="font-size:10px;opacity:0.7;">(${sign}${p.unrealizedPnlPct.toFixed(2)}%)</span>`;
          pnlEl.style.color = p.unrealizedPnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)';
        }
      });

      this._updateTotalPnl();
    }, 1000);
  }
}
