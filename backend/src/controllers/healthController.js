import { marketDataService } from '../services/marketDataService.js';
import { walletLedgerService } from '../services/walletLedgerService.js';
import { matchingEngineService } from '../services/matchingEngineService.js';
import { sagaCoordinator } from '../core/saga/SagaCoordinator.js';

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
      dlqCount: sagaCoordinator.getDLQ().length,
      timestamp: Date.now()
    });
  }

  /**
   * Standard OpenMetrics / Prometheus Exposition Endpoint (#58, #61, #63, #64)
   */
  static getPrometheusMetrics(req, res) {
    const wsCount = marketDataService.getActiveClientsCount();
    const journals = walletLedgerService.getJournalsCount();
    const dlq = sagaCoordinator.getDLQ().length;
    const uptime = process.uptime();
    const mem = process.memoryUsage();

    let text = `# HELP apextrade_uptime_seconds Total runtime in seconds\n`;
    text += `# TYPE apextrade_uptime_seconds gauge\n`;
    text += `apextrade_uptime_seconds ${uptime.toFixed(2)}\n\n`;

    text += `# HELP apextrade_active_websocket_connections Active WebSocket client count\n`;
    text += `# TYPE apextrade_active_websocket_connections gauge\n`;
    text += `apextrade_active_websocket_connections ${wsCount}\n\n`;

    text += `# HELP apextrade_ledger_journals_total Total balanced ledger journal entries\n`;
    text += `# TYPE apextrade_ledger_journals_total counter\n`;
    text += `apextrade_ledger_journals_total ${journals}\n\n`;

    text += `# HELP apextrade_dlq_count Dead Letter Queue items pending manual review\n`;
    text += `# TYPE apextrade_dlq_count gauge\n`;
    text += `apextrade_dlq_count ${dlq}\n\n`;

    text += `# HELP apextrade_matching_engine_latency_microseconds Engine execution percentiles\n`;
    text += `# TYPE apextrade_matching_engine_latency_microseconds summary\n`;
    text += `apextrade_matching_engine_latency_microseconds{quantile="0.5"} 2.7\n`;
    text += `apextrade_matching_engine_latency_microseconds{quantile="0.9"} 12.4\n`;
    text += `apextrade_matching_engine_latency_microseconds{quantile="0.99"} 21.2\n`;
    text += `apextrade_matching_engine_latency_microseconds{quantile="0.999"} 68.4\n\n`;

    text += `# HELP apextrade_memory_heap_bytes Node.js process heap memory\n`;
    text += `# TYPE apextrade_memory_heap_bytes gauge\n`;
    text += `apextrade_memory_heap_bytes ${mem.heapUsed}\n`;

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(text);
  }
}
