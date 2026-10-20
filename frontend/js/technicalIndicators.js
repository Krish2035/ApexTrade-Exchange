/**
 * technicalIndicators.js
 * RSI, MACD, and Bollinger Bands overlay engine for the candlestick chart.
 * Renders indicators on a secondary canvas below the main chart.
 */
export class TechnicalIndicators {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.activeIndicator = 'RSI'; // 'RSI' | 'MACD' | 'VOL'
  }

  /**
   * Calculate RSI (14-period)
   */
  static calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return [];
    const rsi = [];
    let avgGain = 0, avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = period; i < closes.length; i++) {
      if (i === period) {
        rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
      } else {
        const change = closes[i] - closes[i - 1];
        const gain = Math.max(0, change);
        const loss = Math.max(0, -change);
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
      }
    }
    return rsi;
  }

  /**
   * Calculate MACD (12, 26, 9)
   */
  static calcMACD(closes) {
    const ema = (data, period) => {
      const k = 2 / (period + 1);
      let emaVal = data[0];
      return data.map(v => (emaVal = v * k + emaVal * (1 - k)));
    };

    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signal = ema(macdLine.slice(26), 9);
    const histogram = macdLine.slice(26 + 9 - 1).map((v, i) => v - signal[i]);

    return { macdLine: macdLine.slice(26), signal, histogram };
  }

  /**
   * Calculate Bollinger Bands (20, 2)
   */
  static calcBollingerBands(closes, period = 20, stdDev = 2) {
    const bands = [];
    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
      const std = Math.sqrt(variance);
      bands.push({ upper: mean + stdDev * std, mid: mean, lower: mean - stdDev * std });
    }
    return bands;
  }

  render(candles, indicator = null) {
    if (!this.canvas || !this.ctx) return;
    const ind = indicator || this.activeIndicator;

    const { ctx } = this;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#09111a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const closes = candles.map(c => c.close);
    const paddingRight = 65;
    const chartW = w - paddingRight;

    if (ind === 'RSI') {
      this._renderRSI(closes, chartW, h);
    } else if (ind === 'MACD') {
      this._renderMACD(closes, chartW, h);
    } else if (ind === 'VOL') {
      this._renderVolume(candles, chartW, h);
    }

    // Indicator label
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.font = 'bold 11px Calibri, sans-serif';
    ctx.fillText(ind, 8, 14);
  }

  _renderRSI(closes, chartW, h) {
    const { ctx } = this;
    const rsi = TechnicalIndicators.calcRSI(closes);
    if (!rsi.length) return;

    const pad = 16;

    // Overbought / Oversold zones
    const obY = h * (1 - 70 / 100);
    const osY = h * (1 - 30 / 100);

    ctx.fillStyle = 'rgba(255, 51, 102, 0.05)';
    ctx.fillRect(0, pad, chartW, obY - pad);
    ctx.fillStyle = 'rgba(0, 230, 118, 0.05)';
    ctx.fillRect(0, osY, chartW, h - osY - pad);

    // Reference lines
    [30, 50, 70].forEach(level => {
      const y = h - (level / 100) * (h - pad * 2) - pad;
      ctx.strokeStyle = level === 50 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(100,116,139,0.7)';
      ctx.font = '9px Calibri, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(level, chartW + 60, y + 3);
    });

    // RSI Line
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    rsi.forEach((v, i) => {
      const x = ((closes.length - rsi.length + i) / (closes.length - 1)) * chartW;
      const y = h - (v / 100) * (h - pad * 2) - pad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Current RSI value
    const lastRSI = rsi[rsi.length - 1];
    const lastY = h - (lastRSI / 100) * (h - pad * 2) - pad;
    ctx.fillStyle = '#c084fc';
    ctx.fillRect(chartW, lastY - 8, 60, 16);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px Calibri, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`RSI ${lastRSI.toFixed(1)}`, chartW + 4, lastY + 4);
  }

  _renderMACD(closes, chartW, h) {
    const { ctx } = this;
    const { macdLine, signal, histogram } = TechnicalIndicators.calcMACD(closes);
    if (!histogram.length) return;

    const allVals = [...macdLine, ...signal, ...histogram];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = maxV - minV || 1;
    const pad = 10;

    const toY = v => h - pad - ((v - minV) / range) * (h - pad * 2);
    const startIdx = closes.length - histogram.length;

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(chartW, zeroY); ctx.stroke();

    // Histogram bars
    histogram.forEach((v, i) => {
      const x = ((startIdx + i) / (closes.length - 1)) * chartW;
      const barW = Math.max(2, chartW / closes.length - 1);
      const barH = Math.abs(toY(v) - zeroY);
      ctx.fillStyle = v >= 0 ? 'rgba(0,230,118,0.5)' : 'rgba(255,51,102,0.5)';
      ctx.fillRect(x - barW / 2, Math.min(toY(v), zeroY), barW, barH);
    });

    // MACD Line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    macdLine.forEach((v, i) => {
      const x = ((closes.length - macdLine.length + i) / (closes.length - 1)) * chartW;
      i === 0 ? ctx.moveTo(x, toY(v)) : ctx.lineTo(x, toY(v));
    });
    ctx.stroke();

    // Signal Line
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    signal.forEach((v, i) => {
      const x = ((closes.length - signal.length + i) / (closes.length - 1)) * chartW;
      i === 0 ? ctx.moveTo(x, toY(v)) : ctx.lineTo(x, toY(v));
    });
    ctx.stroke();
  }

  _renderVolume(candles, chartW, h) {
    const { ctx } = this;
    const maxVol = Math.max(...candles.map(c => c.volume));
    const pad = 10;

    candles.forEach((c, i) => {
      const x = (i / (candles.length - 1)) * chartW;
      const barW = Math.max(2, chartW / candles.length - 1);
      const barH = (c.volume / maxVol) * (h - pad * 2);
      ctx.fillStyle = c.close >= c.open ? 'rgba(0,230,118,0.4)' : 'rgba(255,51,102,0.4)';
      ctx.fillRect(x - barW / 2, h - pad - barH, barW, barH);
    });

    // Volume label
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.font = '9px Calibri, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${maxVol.toFixed(2)} BTC`, chartW + 60, h - pad);
  }
}
