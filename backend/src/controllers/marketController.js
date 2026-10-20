import { matchingEngineService } from '../services/matchingEngineService.js';
import { marketDataService } from '../services/marketDataService.js';

export class MarketController {
  static getDepth(req, res, next) {
    try {
      const { symbol } = req.params;
      const levels = parseInt(req.query.levels) || 30;
      const depth = matchingEngineService.getL2Depth(symbol, levels);
      return res.json(depth);
    } catch (err) {
      next(err);
    }
  }

  static getTrades(req, res, next) {
    try {
      const { symbol } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const trades = marketDataService.getRecentTrades(symbol, limit);
      return res.json({
        symbol: symbol.toUpperCase(),
        count: trades.length,
        trades
      });
    } catch (err) {
      next(err);
    }
  }

  static getSymbols(req, res, next) {
    try {
      const symbols = matchingEngineService.getAllSymbols();
      return res.json({ symbols });
    } catch (err) {
      next(err);
    }
  }
}
