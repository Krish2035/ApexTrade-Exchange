import { marginRiskEngine } from '../core/risk/MarginRiskEngine.js';
import { marketSurveillanceEngine } from '../core/surveillance/MarketSurveillanceEngine.js';
import { proofOfReserves } from '../core/solvency/ProofOfReserves.js';
import { vaultManager } from '../core/custody/VaultManager.js';
import { marketMakerBot } from '../core/marketmaker/MarketMakerBot.js';
import { fixEngine } from '../core/fix/FixEngine.js';
import { matchingEngineService } from '../services/matchingEngineService.js';

export class InstitutionalController {
  // 1. Margin & Leverage Risk Engine
  static openMarginPosition(req, res, next) {
    try {
      const { symbol = 'BTC-USD', side, size, entryPrice, leverage = 10 } = req.body;
      const userId = req.user ? req.user.sub : (req.body.userId || 'trader-alice');

      const position = marginRiskEngine.openPosition({
        userId,
        symbol,
        side,
        size: Number(size),
        entryPrice: Number(entryPrice),
        leverage: Number(leverage)
      });

      return res.status(201).json({ success: true, position });
    } catch (err) {
      next(err);
    }
  }

  static getPositions(req, res, next) {
    try {
      const userId = req.params.userId || (req.user ? req.user.sub : 'trader-alice');
      const positions = marginRiskEngine.getUserPositions(userId);
      return res.json({
        userId,
        positions,
        insuranceFundBalanceUsd: marginRiskEngine.getInsuranceFundBalance()
      });
    } catch (err) {
      next(err);
    }
  }

  // 2. Market Surveillance Alerts
  static getSurveillanceAlerts(req, res) {
    const alerts = marketSurveillanceEngine.getAlerts();
    return res.json({
      activeAlertsCount: alerts.length,
      alerts
    });
  }

  // 3. Cryptographic Proof of Reserves (PoR)
  static getSolvencyProof(req, res) {
    const proof = proofOfReserves.generateMerkleTree();
    return res.json({
      success: true,
      ...proof
    });
  }

  static getUserProof(req, res) {
    const userId = req.params.userId || 'trader-alice';
    const proof = proofOfReserves.getUserProof(userId);
    return res.json({
      success: true,
      ...proof
    });
  }

  // 4. Custody Vault Breakdown
  static getCustodyBreakdown(req, res) {
    const custody = vaultManager.getCustodyBreakdown();
    return res.json({
      success: true,
      custody
    });
  }

  // 5. Automated Market Maker Bot Control
  static toggleMarketMaker(req, res) {
    const { action } = req.body; // 'START' | 'STOP'
    if (action === 'START') {
      marketMakerBot.start(2500);
    } else {
      marketMakerBot.stop();
    }
    return res.json({ success: true, status: marketMakerBot.getStatus() });
  }

  static getMarketMakerStatus(req, res) {
    return res.json(marketMakerBot.getStatus());
  }

  // 6. Institutional FIX 4.4 Protocol Order Gateway
  static executeFixOrder(req, res, next) {
    try {
      const { fixMessage } = req.body;
      if (!fixMessage) {
        return res.status(400).json({ error: 'fixMessage string required (e.g. 8=FIX.4.4|35=D|...)' });
      }

      const parsedOrder = fixEngine.parseNewOrderSingle(fixMessage);
      const execution = matchingEngineService.placeOrder({
        userId: 'fix-institutional-client',
        symbol: parsedOrder.symbol,
        side: parsedOrder.side,
        type: parsedOrder.type,
        price: parsedOrder.price,
        amount: parsedOrder.amount
      });

      const fixExecutionReport = fixEngine.buildExecutionReport({
        orderId: execution.order.id,
        clientOrderId: parsedOrder.clientOrderId,
        symbol: execution.order.symbol,
        side: execution.order.side,
        price: execution.order.price,
        amount: execution.order.amount,
        status: execution.order.status === 'FILLED' ? '2' : '0'
      });

      return res.json({
        success: true,
        fixExecutionReport,
        order: {
          id: execution.order.id,
          symbol: execution.order.symbol,
          side: execution.order.side,
          type: execution.order.type,
          price: execution.order.price,
          amount: execution.order.amount,
          status: execution.order.status
        },
        trades: execution.trades
      });
    } catch (err) {
      next(err);
    }
  }
}
