import { OrderBook } from './OrderBook.js';
import { Order } from './Order.js';

/**
 * benchmark.js
 * Benchmarks matching engine throughput and latency percentiles
 * (#91 Latency, #92 Throughput, #93 P99 Latency, #94 Tail Latency)
 */
function runBenchmark() {
  const TOTAL_ORDERS = 50000;
  console.log(`\n======================================================`);
  console.log(`🚀 ApexTrade Matching Engine Benchmark`);
  console.log(`Executing ${TOTAL_ORDERS.toLocaleString()} order match operations...`);
  console.log(`======================================================\n`);

  const book = new OrderBook('BTC-USD');
  const latenciesNs = [];

  // Seed book with 5,000 resting liquidity limit orders (makers)
  console.log('Seeding initial book depth with 5,000 limit orders...');
  for (let i = 0; i < 2500; i++) {
    book.processOrder(new Order({
      id: `seed-bid-${i}`,
      userId: `maker-bid-${i % 50}`,
      symbol: 'BTC-USD',
      side: 'BUY',
      type: 'LIMIT',
      price: 60000 - (i * 0.5),
      amount: 1.0
    }));

    book.processOrder(new Order({
      id: `seed-ask-${i}`,
      userId: `maker-ask-${i % 50}`,
      symbol: 'BTC-USD',
      side: 'SELL',
      type: 'LIMIT',
      price: 60001 + (i * 0.5),
      amount: 1.0
    }));
  }

  // Benchmark hot loop: mix of aggressive taker orders & limit orders
  const startTime = process.hrtime.bigint();

  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const isBuy = (i % 2 === 0);
    const isMarket = (i % 5 === 0);
    const price = isBuy ? (60001 + (i % 20)) : (60000 - (i % 20));

    const order = new Order({
      id: `bench-ord-${i}`,
      userId: `trader-${i % 100}`,
      symbol: 'BTC-USD',
      side: isBuy ? 'BUY' : 'SELL',
      type: isMarket ? 'MARKET' : 'LIMIT',
      price: isMarket ? 0 : price,
      amount: 0.1
    });

    const opStart = process.hrtime.bigint();
    book.processOrder(order);
    const opEnd = process.hrtime.bigint();

    latenciesNs.push(Number(opEnd - opStart));
  }

  const endTime = process.hrtime.bigint();
  const totalDurationSeconds = Number(endTime - startTime) / 1e9;
  const throughputOpsPerSec = Math.round(TOTAL_ORDERS / totalDurationSeconds);

  // Compute Latency Percentiles (convert ns to microseconds)
  latenciesNs.sort((a, b) => a - b);
  const p50 = (latenciesNs[Math.floor(latenciesNs.length * 0.50)] / 1000).toFixed(2);
  const p90 = (latenciesNs[Math.floor(latenciesNs.length * 0.90)] / 1000).toFixed(2);
  const p99 = (latenciesNs[Math.floor(latenciesNs.length * 0.99)] / 1000).toFixed(2);
  const p999 = (latenciesNs[Math.floor(latenciesNs.length * 0.999)] / 1000).toFixed(2);
  const max = (latenciesNs[latenciesNs.length - 1] / 1000).toFixed(2);

  console.log(`📊 Benchmark Results:`);
  console.log(`------------------------------------------------------`);
  console.log(`Total Orders Processed : ${TOTAL_ORDERS.toLocaleString()}`);
  console.log(`Execution Time         : ${totalDurationSeconds.toFixed(3)}s`);
  console.log(`Throughput             : ${throughputOpsPerSec.toLocaleString()} orders/sec`);
  console.log(`------------------------------------------------------`);
  console.log(`Latency Percentiles (#91 Latency, #93 P99, #94 Tail):`);
  console.log(`  P50  (Median)        : ${p50} µs`);
  console.log(`  P90                  : ${p90} µs`);
  console.log(`  P99  (P99 Latency)   : ${p99} µs`);
  console.log(`  P99.9                : ${p999} µs`);
  console.log(`  Max Tail Latency     : ${max} µs`);
  console.log(`------------------------------------------------------\n`);
}

runBenchmark();
