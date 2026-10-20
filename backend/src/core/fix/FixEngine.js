/**
 * FixEngine.js
 * Financial Information eXchange (FIX Protocol 4.4) Parser & Engine
 * (#98 TCP/UDP, #100 gRPC / Binary protocols)
 * 
 * Standard Tags:
 * 8=FIX.4.4 | 9=BodyLength | 35=MsgType (D=NewOrder, 8=ExecutionReport, F=Cancel)
 * 11=ClOrdID | 38=OrderQty | 44=Price | 54=Side (1=Buy, 2=Sell) | 55=Symbol
 */
export class FixEngine {
  constructor() {
    this.delimiter = '\x01'; // SOH (Start of Header) standard ASCII delimiter
    this.fallbackDelimiter = '|';
  }

  /**
   * Parses raw FIX message string into structured key-value tag map
   * @param {string} rawFix
   * @returns {Map<number, string>}
   */
  parse(rawFix) {
    const delim = rawFix.includes('\x01') ? '\x01' : '|';
    const pairs = rawFix.split(delim).filter(Boolean);
    const tags = new Map();

    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx !== -1) {
        const tag = parseInt(pair.substring(0, idx));
        const val = pair.substring(idx + 1);
        tags.set(tag, val);
      }
    }

    return tags;
  }

  /**
   * Converts a FIX NewOrderSingle (35=D) message into an internal exchange order
   * @param {string} rawFix
   */
  parseNewOrderSingle(rawFix) {
    const tags = this.parse(rawFix);
    const msgType = tags.get(35);

    if (msgType !== 'D') {
      throw new Error(`Invalid FIX message type: expected 35=D, got 35=${msgType}`);
    }

    const clientOrderId = tags.get(11) || `fix-ord-${Date.now()}`;
    const symbol = tags.get(55) || 'BTC-USD';
    const side = tags.get(54) === '1' ? 'BUY' : 'SELL';
    const amount = parseFloat(tags.get(38));
    const price = parseFloat(tags.get(44)) || 0;
    const orderType = price > 0 ? 'LIMIT' : 'MARKET';

    return {
      clientOrderId,
      symbol,
      side,
      type: orderType,
      amount,
      price
    };
  }

  /**
   * Generates a FIX 4.4 ExecutionReport (35=8)
   */
  buildExecutionReport({ orderId, clientOrderId, symbol, side, price, amount, status = '0' }) {
    const sideTag = side === 'BUY' ? '1' : '2';
    const body = [
      '35=8',
      `11=${clientOrderId}`,
      `37=${orderId}`,
      `39=${status}`,
      `55=${symbol}`,
      `54=${sideTag}`,
      `38=${amount}`,
      `44=${price}`,
      `150=0`,
      `60=${new Date().toISOString()}`
    ].join('|');

    return `8=FIX.4.4|9=${body.length}|${body}|10=042|`;
  }
}

export const fixEngine = new FixEngine();
