/**
 * tradeTickerWidget.js
 * Live executed trade ticker streaming trades from WebSocket
 * (#22 WebSockets, #91 Latency)
 */
export class TradeTickerWidget {
  constructor(containerId) {
    this.list = document.getElementById(containerId);
  }

  addTrades(trades) {
    if (!trades || trades.length === 0) return;

    for (const trade of trades) {
      const timeStr = new Date(trade.timestamp).toLocaleTimeString([], { hour12: false });
      const sideClass = (trade.takerSide || 'BUY').toLowerCase();

      const row = document.createElement('div');
      row.className = `trade-row ${sideClass}`;
      row.innerHTML = `
        <span class="price">${Number(trade.price).toLocaleString()}</span>
        <span class="size">${Number(trade.amount).toFixed(4)}</span>
        <span class="time">${timeStr}</span>
      `;

      this.list.prepend(row);

      // Keep maximum 50 rows in DOM to avoid memory leak (#41 Memory Leaks)
      if (this.list.children.length > 50) {
        this.list.removeChild(this.list.lastChild);
      }
    }
  }

  setInitialTrades(trades) {
    this.list.innerHTML = '';
    this.addTrades(trades);
  }
}
