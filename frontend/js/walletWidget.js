import { CONFIG } from './config.js';

/**
 * walletWidget.js
 * Account portfolio and double-entry wallet balance viewer
 */
export class WalletWidget {
  constructor(containerId, balancePillId) {
    this.container = document.getElementById(containerId);
    this.pill = document.getElementById(balancePillId);
    this.fetchBalances();
  }

  async fetchBalances() {
    try {
      const res = await fetch(`${CONFIG.GATEWAY_HTTP}/wallets/${CONFIG.USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      this.render(data.wallets || []);
    } catch (err) {
      console.warn('[Wallet] Failed to fetch balances:', err.message);
    }
  }

  render(wallets) {
    if (!wallets) return;

    let usdTotal = 0;
    const rows = wallets.map(w => {
      if (w.currency === 'USD') usdTotal = w.available;
      return `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 11px;">
          <span style="font-weight: 700; color: var(--color-accent);">${w.currency}</span>
          <span>Avail: <strong>${Number(w.available).toLocaleString()}</strong></span>
          <span style="color: var(--text-muted);">Locked: ${Number(w.locked).toLocaleString()}</span>
        </div>
      `;
    }).join('');

    if (this.container) {
      this.container.innerHTML = rows;
    }

    if (this.pill) {
      this.pill.innerHTML = `
        <span style="font-size: 10px; color: var(--text-muted);">BALANCE:</span>
        <span style="font-family: var(--font-mono); font-weight: 700; color: var(--color-buy);">$${Number(usdTotal).toLocaleString()}</span>
      `;
    }
  }
}
