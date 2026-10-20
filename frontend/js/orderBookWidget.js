/**
 * orderBookWidget.js
 * Visual Level 2 Order Book Depth Ladder with dynamic cumulative volume bars
 * (#49 Edge Caching, #22 WebSockets, #91 Latency)
 */
export class OrderBookWidget {
  constructor(containerId, onPriceSelect) {
    this.container = document.getElementById(containerId);
    this.onPriceSelect = onPriceSelect || (() => {});
    this.asksContainer = this.container.querySelector('#book-asks');
    this.bidsContainer = this.container.querySelector('#book-bids');
    this.spreadBanner = this.container.querySelector('#book-spread-banner');
  }

  update(depth) {
    if (!depth) return;
    const { bids = [], asks = [], bestBid, bestAsk, spread } = depth;

    // Calculate max depth volume for relative visual bars
    let maxVolume = 0;
    for (const [p, v] of asks) if (v > maxVolume) maxVolume = v;
    for (const [p, v] of bids) if (v > maxVolume) maxVolume = v;
    if (maxVolume === 0) maxVolume = 1;

    // Render Asks (Reversed so lowest ask is at the bottom nearest the spread)
    const displayAsks = asks.slice(0, 12).reverse();
    this.asksContainer.innerHTML = displayAsks.map(([price, vol]) => {
      const pct = Math.min(100, (vol / maxVolume) * 100);
      const total = (price * vol).toFixed(2);
      return `
        <div class="book-row ask" data-price="${price}">
          <div class="depth-bar" style="width: ${pct}%"></div>
          <span class="price">${price.toLocaleString()}</span>
          <span class="size">${vol.toFixed(4)}</span>
          <span class="total col-right">${Number(total).toLocaleString()}</span>
        </div>
      `;
    }).join('');

    // Render Spread Banner
    const midPrice = (bestBid && bestAsk) ? ((bestBid + bestAsk) / 2).toFixed(2) : '--';
    const spreadPct = (bestBid && spread) ? ((spread / bestBid) * 100).toFixed(3) : '0.000';
    this.spreadBanner.innerHTML = `
      <div class="mid-price">
        <span>${Number(midPrice).toLocaleString()}</span>
        <span style="font-size: 11px; color: var(--text-muted)">USD</span>
      </div>
      <div class="spread-info">
        Spread: ${spread !== null ? spread : '--'} (${spreadPct}%)
      </div>
    `;

    // Render Bids (Highest bid at the top nearest the spread)
    const displayBids = bids.slice(0, 12);
    this.bidsContainer.innerHTML = displayBids.map(([price, vol]) => {
      const pct = Math.min(100, (vol / maxVolume) * 100);
      const total = (price * vol).toFixed(2);
      return `
        <div class="book-row bid" data-price="${price}">
          <div class="depth-bar" style="width: ${pct}%"></div>
          <span class="price">${price.toLocaleString()}</span>
          <span class="size">${vol.toFixed(4)}</span>
          <span class="total col-right">${Number(total).toLocaleString()}</span>
        </div>
      `;
    }).join('');

    // Attach click handlers to rows to fill price
    this.container.querySelectorAll('.book-row').forEach(row => {
      row.addEventListener('click', () => {
        const price = row.getAttribute('data-price');
        this.onPriceSelect(price);
      });
    });
  }
}
