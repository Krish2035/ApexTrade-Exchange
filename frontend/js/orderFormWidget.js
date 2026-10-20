import { CONFIG } from './config.js';

/**
 * orderFormWidget.js
 * Order entry widget supporting Limit/Market orders with Idempotency Key injection
 * (#14 Idempotency, #4 Reverse Proxies, #5 API Gateways)
 */
export class OrderFormWidget {
  constructor({ onOrderSuccess, showToast }) {
    this.onOrderSuccess = onOrderSuccess || (() => {});
    this.showToast = showToast || console.log;

    this.side = 'BUY'; // 'BUY' | 'SELL'
    this.type = 'LIMIT'; // 'LIMIT' | 'MARKET'
    this.symbol = CONFIG.DEFAULT_SYMBOL;

    this.priceInput = document.getElementById('input-order-price');
    this.amountInput = document.getElementById('input-order-amount');
    this.totalDisplay = document.getElementById('order-total-val');
    this.submitBtn = document.getElementById('btn-submit-order');
    this.idempotencyTag = document.getElementById('active-idempotency-key');

    this.leverage = 1;
    this.marginCollateralDisplay = document.getElementById('margin-collateral-val');
    this.liqPriceDisplay = document.getElementById('margin-liq-price-val');

    this._bindEvents();
    this._refreshIdempotencyKey();
    this._recalcTotal();
  }

  _bindEvents() {
    // Leverage pills
    document.querySelectorAll('#leverage-pill-group .chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#leverage-pill-group .chip-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.leverage = parseInt(btn.getAttribute('data-lev')) || 1;
        this._recalcTotal();
      });
    });

    // Buy / Sell Side Buttons
    document.querySelectorAll('.side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.side = btn.getAttribute('data-side');

        this.submitBtn.className = `order-submit-btn ${this.side.toLowerCase()}`;
        this.submitBtn.textContent = `${this.side} ${this.baseAsset || 'BTC'}`;
        this._recalcTotal();
      });
    });

    // Limit / Market Type Tabs
    document.querySelectorAll('.type-tab-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.type-tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.type = tab.getAttribute('data-type');

        const priceWrapper = document.getElementById('price-field-wrapper');
        if (this.type === 'MARKET') {
          priceWrapper.style.opacity = '0.4';
          priceWrapper.style.pointerEvents = 'none';
          this.priceInput.value = 'Market Price';
        } else {
          priceWrapper.style.opacity = '1';
          priceWrapper.style.pointerEvents = 'auto';
          if (this.priceInput.value === 'Market Price') this.priceInput.value = '64250';
        }
        this._recalcTotal();
      });
    });

    // Inputs recalculate total
    this.priceInput.addEventListener('input', () => this._recalcTotal());
    this.amountInput.addEventListener('input', () => this._recalcTotal());

    // Percentage quick chips
    document.querySelectorAll('.percent-slider-chips .chip-btn').forEach(chip => {
      chip.addEventListener('click', () => {
        const pct = parseFloat(chip.getAttribute('data-pct'));
        const userAvailableUsd = 100000;
        const price = parseFloat(this.priceInput.value) || 64250;
        const calculatedBtc = ((userAvailableUsd * pct) / price).toFixed(4);
        this.amountInput.value = calculatedBtc;
        this._recalcTotal();
      });
    });

    // Submit Order Button
    this.submitBtn.addEventListener('click', () => this.submitOrder());
  }

  _recalcTotal() {
    const p = parseFloat(this.priceInput.value) || 64250;
    const a = parseFloat(this.amountInput.value) || 0;
    const total = p * a;
    const collateral = this.leverage > 1 ? (total / this.leverage) : total;

    // Calculate Estimated Liquidation Price for Margin Trading
    let liqPrice = 0;
    if (this.leverage > 1) {
      if (this.side === 'BUY') {
        liqPrice = p * (1 - (1 / this.leverage) + 0.05);
      } else {
        liqPrice = p * (1 + (1 / this.leverage) - 0.05);
      }
    }

    if (this.totalDisplay) {
      this.totalDisplay.textContent = `$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (this.marginCollateralDisplay) {
      this.marginCollateralDisplay.textContent = `$${collateral.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (this.liqPriceDisplay) {
      this.liqPriceDisplay.textContent = this.leverage > 1 ? `$${Math.max(0, liqPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A (1x Spot)';
    }
  }

  _refreshIdempotencyKey() {
    this.currentIdempotencyKey = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    if (this.idempotencyTag) {
      this.idempotencyTag.textContent = this.currentIdempotencyKey;
    }
  }

  setPrice(price) {
    if (this.type === 'LIMIT') {
      this.priceInput.value = price;
      this._recalcTotal();
    }
  }

  setSymbol(symbol, currentPrice, userBalance) {
    this.symbol = symbol;
    this.baseAsset = symbol.replace('-USD', '');

    // 1. Update Price input
    if (this.priceInput && this.type !== 'MARKET') {
      const formatted = currentPrice < 1 ? currentPrice.toFixed(4) : currentPrice.toFixed(2);
      this.priceInput.value = formatted;
    }

    // 2. Update Submit button
    if (this.submitBtn) {
      this.submitBtn.textContent = `${this.side} ${this.baseAsset}`;
    }

    // 3. Update currency badges
    const amtCurrencyBadge = document.getElementById('order-amount-currency');
    if (amtCurrencyBadge) amtCurrencyBadge.textContent = this.baseAsset;

    const availBadge = document.getElementById('order-avail-balance');
    if (availBadge) {
      const balStr = userBalance !== undefined ? `${userBalance} ${this.baseAsset}` : (this.baseAsset === 'BTC' ? '5.000 BTC' : this.baseAsset === 'ETH' ? '25.00 ETH' : this.baseAsset === 'SOL' ? '150.0 SOL' : `1,000 ${this.baseAsset}`);
      availBadge.textContent = `Avail: ${balStr}`;
    }

    const bestAskLabel = document.getElementById('order-best-ask-label');
    if (bestAskLabel) {
      const formatted = currentPrice < 1 ? currentPrice.toFixed(4) : Number(currentPrice).toLocaleString('en-US', { minimumFractionDigits: 2 });
      bestAskLabel.textContent = `Best Ask: $${formatted}`;
    }

    // 4. Default amount based on asset price scale
    if (this.amountInput) {
      if (currentPrice > 10000) this.amountInput.value = '0.25';
      else if (currentPrice > 1000) this.amountInput.value = '2.5';
      else if (currentPrice > 100) this.amountInput.value = '15.0';
      else if (currentPrice > 10) this.amountInput.value = '50.0';
      else this.amountInput.value = '1000';
    }

    this._recalcTotal();
  }

  async submitOrder() {
    const amount = parseFloat(this.amountInput.value);
    const price = this.type === 'LIMIT' ? parseFloat(this.priceInput.value) : 0;

    if (!amount || amount <= 0) {
      this.showToast('Please enter a valid amount', 'error');
      return;
    }

    if (this.type === 'LIMIT' && (!price || price <= 0)) {
      this.showToast('Please enter a valid limit price', 'error');
      return;
    }

    this.submitBtn.disabled = true;
    this.submitBtn.style.opacity = '0.6';

    try {
      // Send request strictly to the API Gateway (#4, #5) with Idempotency Key (#14)
      const response = await fetch(`${CONFIG.GATEWAY_HTTP}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': this.currentIdempotencyKey
        },
        body: JSON.stringify({
          userId: CONFIG.USER_ID,
          symbol: this.symbol,
          side: this.side,
          type: this.type,
          price,
          amount
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || 'Order placement failed');
      }

      const isCacheHit = response.headers.get('x-cache-lookup') === 'HIT';
      const msg = isCacheHit
        ? `[Idempotent Replay] Order ${result.order.id} recognized from cache.`
        : `Order ${result.order.id} submitted! (${result.order.status})`;

      this.showToast(msg, 'success');
      this.onOrderSuccess(result);

      // Generate a new idempotency key for next order
      this._refreshIdempotencyKey();

    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.style.opacity = '1';
    }
  }
}
