import { matchingEngineService } from '../services/matchingEngineService.js';
import { walletLedgerService } from '../services/walletLedgerService.js';
import { marketDataService } from '../services/marketDataService.js';

export class OrderController {
  static async placeOrder(req, res, next) {
    try {
      const { userId = 'trader-alice', symbol = 'BTC-USD', side, type, price, amount, timeInForce } = req.body;

      if (!side || !type || !amount) {
        return res.status(400).json({ error: 'Missing required order fields: side, type, amount' });
      }

      // Execute order placement under distributed user lock (#38 Distributed Locks, #39 Race Conditions)
      const result = await walletLedgerService.executeUnderLock(userId, async () => {
        const execution = matchingEngineService.placeOrder({
          userId,
          symbol,
          side,
          type,
          price: Number(price) || 0,
          amount: Number(amount),
          timeInForce,
          idempotencyKey: req.headers['idempotency-key']
        });

        // Record & broadcast trade events if matched
        if (execution.trades.length > 0) {
          marketDataService.recordTrades(execution.trades);
          const updatedDepth = matchingEngineService.getL2Depth(symbol, 25);
          marketDataService.broadcastTrades(symbol, execution.trades, updatedDepth);
        } else {
          // Broadcast depth update for resting limit order
          const updatedDepth = matchingEngineService.getL2Depth(symbol, 25);
          marketDataService.broadcastDepth(symbol, updatedDepth);
        }

        return execution;
      });

      return res.status(201).json({
        success: true,
        order: {
          id: result.order.id,
          symbol: result.order.symbol,
          side: result.order.side,
          type: result.order.type,
          price: result.order.price,
          amount: result.order.amount,
          filled: result.order.filled,
          remaining: result.order.remaining,
          status: result.order.status
        },
        tradesExecuted: result.trades.length,
        trades: result.trades
      });
    } catch (err) {
      next(err);
    }
  }

  static async cancelOrder(req, res, next) {
    try {
      const { symbol, orderId } = req.params;
      const cancelled = matchingEngineService.cancelOrder(symbol, orderId);

      // Broadcast depth update
      const depth = matchingEngineService.getL2Depth(symbol, 25);
      marketDataService.broadcastDepth(symbol, depth);

      return res.json({
        success: true,
        message: `Order ${orderId} cancelled`,
        order: cancelled
      });
    } catch (err) {
      next(err);
    }
  }
}
