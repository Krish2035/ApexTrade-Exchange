/**
 * chartEngine.js
 * High-performance 60FPS HTML5 Canvas Candlestick & Volume Chart Engine
 */
export class ChartEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.candles = [];
    this.crosshair = null;
    this.currentPrice = 64250;

    this._initCanvasResolution();
    this._generateInitialHistory();
    this._bindEvents();
    this.render();
  }

  _initCanvasResolution() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    window.addEventListener('resize', () => {
      const newRect = this.canvas.parentElement.getBoundingClientRect();
      this.width = newRect.width;
      this.height = newRect.height;
      this.canvas.width = this.width * dpr;
      this.canvas.height = this.height * dpr;
      this.ctx.scale(dpr, dpr);
      this.render();
    });
  }

  _generateInitialHistory() {
    let price = 64100;
    const now = Date.now();
    for (let i = 40; i >= 0; i--) {
      const open = price;
      const change = (Math.random() - 0.48) * 60;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * 30;
      const low = Math.min(open, close) - Math.random() * 30;
      const volume = 2 + Math.random() * 15;

      this.candles.push({
        time: now - (i * 60000),
        open,
        high,
        low,
        close,
        volume
      });
      price = close;
    }
    this.currentPrice = price;
  }

  updateFromTrade(trade) {
    this.currentPrice = trade.price;
    const lastCandle = this.candles[this.candles.length - 1];
    if (lastCandle) {
      lastCandle.close = trade.price;
      lastCandle.high = Math.max(lastCandle.high, trade.price);
      lastCandle.low = Math.min(lastCandle.low, trade.price);
      lastCandle.volume += trade.amount;
    }

    // Auto-append new candle every minute
    const now = Date.now();
    if (now - lastCandle.time > 60000) {
      this.candles.push({
        time: now,
        open: this.currentPrice,
        high: this.currentPrice,
        low: this.currentPrice,
        close: this.currentPrice,
        volume: 0
      });
      if (this.candles.length > 80) this.candles.shift();
    }

    this.render();
  }

  /**
   * Calculate EMA for overlay
   */
  _calcEMA(period) {
    const k = 2 / (period + 1);
    let ema = this.candles[0].close;
    return this.candles.map(c => (ema = c.close * k + ema * (1 - k)));
  }

  /**
   * Render EMA overlay on chart
   */
  _renderEMAOverlay(emaValues, chartW, chartH, minPrice, priceRange, color) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    emaValues.forEach((v, i) => {
      const x = i * (chartW / this.candles.length) + (chartW / this.candles.length / 2);
      const y = chartH - ((v - minPrice) / priceRange) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  _bindEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.crosshair = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.crosshair = null;
      this.render();
    });
  }

  render() {
    const { ctx, width, height } = this;
    if (!width || !height) return;

    // Clear background
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, width, height);

    const paddingRight = 65;
    const paddingBottom = 30;
    const chartWidth = width - paddingRight;
    const chartHeight = height - paddingBottom;
    const volumeHeight = chartHeight * 0.22;

    // Calculate Min & Max Price
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0;

    for (const c of this.candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVolume) maxVolume = c.volume;
    }

    const priceRange = (maxPrice - minPrice) || 1;
    const candleWidth = Math.max(4, (chartWidth / this.candles.length) - 3);

    // 1. Draw Grid Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      const priceAtY = maxPrice - (priceRange * (y / chartHeight));
      ctx.fillStyle = '#64748b';
      ctx.font = '11px "Calibri", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(priceAtY.toFixed(1), chartWidth + 6, y + 3);
    }

    // 2. Render Candlesticks and Volume Bars
    for (let i = 0; i < this.candles.length; i++) {
      const c = this.candles[i];
      const isUp = c.close >= c.open;
      const color = isUp ? '#00e676' : '#ff3366';
      const volumeColor = isUp ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 51, 102, 0.25)';

      const x = i * (chartWidth / this.candles.length) + (candleWidth / 2);
      const openY = chartHeight - ((c.open - minPrice) / priceRange) * chartHeight;
      const closeY = chartHeight - ((c.close - minPrice) / priceRange) * chartHeight;
      const highY = chartHeight - ((c.high - minPrice) / priceRange) * chartHeight;
      const lowY = chartHeight - ((c.low - minPrice) / priceRange) * chartHeight;

      // Volume bar
      const volBarH = (c.volume / maxVolume) * volumeHeight;
      ctx.fillStyle = volumeColor;
      ctx.fillRect(x - (candleWidth / 2), chartHeight - volBarH, candleWidth, volBarH);

      // Wick
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(2, Math.abs(openY - closeY));
      ctx.fillRect(x - (candleWidth / 2), bodyY, candleWidth, bodyH);
    }

    // 3. Render EMA Overlays (EMA20 in blue, EMA50 in orange)
    if (this.candles.length >= 20) {
      this._renderEMAOverlay(this._calcEMA(20), chartWidth, chartHeight, minPrice, priceRange, 'rgba(56, 189, 248, 0.7)');
    }
    if (this.candles.length >= 50) {
      this._renderEMAOverlay(this._calcEMA(50), chartWidth, chartHeight, minPrice, priceRange, 'rgba(249, 115, 22, 0.7)');
    }

    // EMA Labels
    if (this.candles.length >= 20) {
      ctx.fillStyle = 'rgba(56,189,248,0.8)';
      ctx.font = '9px Calibri, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('EMA20', 6, 14);
    }
    if (this.candles.length >= 50) {
      ctx.fillStyle = 'rgba(249,115,22,0.8)';
      ctx.fillText('EMA50', 6, 26);
    }

    // 4. Render Current Price Line
    const currentY = chartHeight - ((this.currentPrice - minPrice) / priceRange) * chartHeight;
    ctx.strokeStyle = '#00f2fe';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, currentY);
    ctx.lineTo(chartWidth, currentY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price tag badge
    ctx.fillStyle = '#00f2fe';
    ctx.fillRect(chartWidth, currentY - 9, paddingRight, 18);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 11px "Calibri", sans-serif';
    ctx.fillText(this.currentPrice.toFixed(2), chartWidth + 6, currentY + 4);

    // 4. Render Crosshair if hovering
    if (this.crosshair && this.crosshair.x <= chartWidth && this.crosshair.y <= chartHeight) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.setLineDash([2, 2]);

      // Vertical
      ctx.beginPath();
      ctx.moveTo(this.crosshair.x, 0);
      ctx.lineTo(this.crosshair.x, chartHeight);
      ctx.stroke();

      // Horizontal
      ctx.beginPath();
      ctx.moveTo(0, this.crosshair.y);
      ctx.lineTo(chartWidth, this.crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
