/**
 * marketScreener.js
 * Real-time multi-asset market screener with price updates and sparklines.
 * Simulates live feeds for multiple trading pairs.
 */
export class MarketScreener {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.markets = [
      { symbol: 'BTC-USD', name: 'Bitcoin',     price: 64250.00, change: +2.45, volume: '4.2B', icon: '₿' },
      { symbol: 'ETH-USD', name: 'Ethereum',    price:  3842.50, change: +1.82, volume: '2.1B', icon: 'Ξ' },
      { symbol: 'SOL-USD', name: 'Solana',      price:   168.42, change: +5.14, volume: '890M', icon: '◎' },
      { symbol: 'BNB-USD', name: 'BNB',         price:   571.30, change: -0.74, volume: '620M', icon: 'B' },
      { symbol: 'XRP-USD', name: 'XRP',         price:     0.548, change: +3.21, volume: '1.4B', icon: 'X' },
      { symbol: 'ADA-USD', name: 'Cardano',     price:     0.492, change: -1.32, volume: '380M', icon: 'A' },
      { symbol: 'DOGE-USD',name: 'Dogecoin',    price:     0.176, change: +7.88, volume: '1.2B', icon: 'Ð' },
      { symbol: 'AVAX-USD',name: 'Avalanche',   price:    38.94, change: +4.22, volume: '210M', icon: 'A' },
      { symbol: 'LINK-USD',name: 'Chainlink',   price:    14.72, change: -2.11, volume: '160M', icon: '🔗' },
      { symbol: 'UNI-USD', name: 'Uniswap',     price:     8.91, change: +1.65, volume: '95M',  icon: '🦄' },
    ];
    this.activeSymbol = 'BTC-USD';
    this.sparklineData = {};
    this._generateSparklines();
    this._render();
    this._startLiveFeed();
  }

  _generateSparklines() {
    this.markets.forEach(m => {
      const pts = [];
      let p = m.price;
      for (let i = 0; i < 20; i++) {
        p += (Math.random() - 0.5) * (p * 0.005);
        pts.push(p);
      }
      this.sparklineData[m.symbol] = pts;
    });
  }

  _drawSparkline(canvas, data, isPositive) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const color = isPositive ? '#00e676' : '#ff3366';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h * 0.8 - h * 0.1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = isPositive ? 'rgba(0,230,118,0.08)' : 'rgba(255,51,102,0.08)';
    ctx.fill();
  }

  _render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="screener-header">
        <span>Market Screener</span>
        <span style="font-size:10px;color:var(--color-buy);">● LIVE</span>
      </div>
      <div class="screener-search">
        <input type="text" id="screener-search-input" placeholder="🔍 Search markets..." />
      </div>
      <div class="screener-list" id="screener-market-list">
        ${this.markets.map(m => this._renderRow(m)).join('')}
      </div>
    `;

    // Draw sparklines
    this.markets.forEach(m => {
      const canvas = document.getElementById(`spark-${m.symbol}`);
      if (canvas) this._drawSparkline(canvas, this.sparklineData[m.symbol], m.change >= 0);
    });

    // Click handlers
    this.container.querySelectorAll('.screener-row').forEach(row => {
      row.addEventListener('click', () => {
        const sym = row.getAttribute('data-symbol');
        this.activeSymbol = sym;
        document.querySelectorAll('.screener-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        // Dispatch event to update active market
        window.dispatchEvent(new CustomEvent('market:selected', { detail: { symbol: sym } }));
      });
    });

    // Search filter
    const searchInput = document.getElementById('screener-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.screener-row').forEach(row => {
          const sym = row.getAttribute('data-symbol').toLowerCase();
          const name = row.querySelector('.screener-coin-name')?.textContent.toLowerCase() || '';
          row.style.display = (sym.includes(q) || name.includes(q)) ? '' : 'none';
        });
      });
    }
  }

  _renderRow(m) {
    const isPos = m.change >= 0;
    const changeColor = isPos ? 'var(--color-buy)' : 'var(--color-sell)';
    const isActive = m.symbol === this.activeSymbol;
    const formattedPrice = m.price < 1 ? m.price.toFixed(4) : m.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `
      <div class="screener-row ${isActive ? 'active' : ''}" data-symbol="${m.symbol}">
        <div class="screener-coin-info">
          <div class="screener-coin-icon">${m.icon}</div>
          <div>
            <div class="screener-coin-symbol">${m.symbol.replace('-USD', '')}</div>
            <div class="screener-coin-name">${m.name}</div>
          </div>
        </div>
        <canvas id="spark-${m.symbol}" width="60" height="28" style="align-self:center;"></canvas>
        <div class="screener-coin-prices">
          <div class="screener-coin-price" id="screener-price-${m.symbol}">$${formattedPrice}</div>
          <div class="screener-coin-change" style="color:${changeColor};" id="screener-change-${m.symbol}">
            ${isPos ? '+' : ''}${m.change.toFixed(2)}%
          </div>
        </div>
      </div>
    `;
  }

  _startLiveFeed() {
    setInterval(() => {
      this.markets.forEach(m => {
        // Simulate price tick
        const tick = (Math.random() - 0.49) * (m.price * 0.0008);
        m.price = Math.max(0.001, m.price + tick);
        m.change += (Math.random() - 0.5) * 0.02;

        // Update sparkline data
        const data = this.sparklineData[m.symbol];
        data.push(m.price);
        if (data.length > 20) data.shift();

        // Update DOM without full re-render
        const priceEl = document.getElementById(`screener-price-${m.symbol}`);
        const changeEl = document.getElementById(`screener-change-${m.symbol}`);
        const canvas   = document.getElementById(`spark-${m.symbol}`);

        if (priceEl) {
          const formatted = m.price < 1 ? m.price.toFixed(4) : m.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          priceEl.textContent = `$${formatted}`;
          priceEl.style.color = tick >= 0 ? 'var(--color-buy)' : 'var(--color-sell)';
          setTimeout(() => { if (priceEl) priceEl.style.color = ''; }, 400);
        }
        if (changeEl) {
          const isPos = m.change >= 0;
          changeEl.textContent = `${isPos ? '+' : ''}${m.change.toFixed(2)}%`;
          changeEl.style.color = isPos ? 'var(--color-buy)' : 'var(--color-sell)';
        }
        if (canvas) {
          this._drawSparkline(canvas, data, m.change >= 0);
        }
      });
    }, 800);
  }
}
