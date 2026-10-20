import { marketDataService } from '../services/marketDataService.js';
import { walletLedgerService } from '../services/walletLedgerService.js';
import { matchingEngineService } from '../services/matchingEngineService.js';

export class HealthController {
  static getHealth(req, res) {
    res.json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      activeWebSockets: marketDataService.getActiveClientsCount()
    });
  }

  static getMetrics(req, res) {
    res.json({
      activeWebSockets: marketDataService.getActiveClientsCount(),
      totalLedgerJournals: walletLedgerService.getJournalsCount(),
      symbols: matchingEngineService.getAllSymbols(),
      timestamp: Date.now()
    });
  }
}
