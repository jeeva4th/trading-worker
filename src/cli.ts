import Table from 'cli-table3';
import { ExchangeConnector } from './connectors/exchange';
import { createStrategy, STRATEGY_CATALOG } from './strategies';
import { BacktestEngine } from './engine/backtester';
import { PaperTrader } from './engine/paperTrader';
import { startServer } from './server';
import { StrategyId } from './types';
import { parseTradingViewInput } from './utils/tradingviewParser';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'backtest';
  const rawInput = args[1] || 'BTC/USDT';
  const parsed = parseTradingViewInput(rawInput);
  const symbol = parsed.symbol;
  const timeframe = args[2] || parsed.timeframe || '1h';
  const strategyArg = (args[3] || 'adaptive') as StrategyId;

  if (command === 'web' || command === 'ui' || command === 'server') {
    startServer();
    return;
  }

  const exchange = new ExchangeConnector('binance');

  console.log(`\n======================================================`);
  console.log(`🚀 Quantitative Trading Worker [High-Profit Engine]`);
  console.log(`Exchange: ${exchange.getExchangeName()} | Pair: ${symbol} | Timeframe: ${timeframe}`);
  console.log(`======================================================\n`);

  if (command === 'analyze') {
    const actionArg = (args[3] || 'ANALYZE').toUpperCase() as 'BUY' | 'SELL' | 'CLOSE' | 'ANALYZE';
    const trader = new PaperTrader('binance');
    const state = await trader.executeTradingViewSignal({
      symbol,
      action: ['BUY', 'SELL', 'CLOSE', 'ANALYZE'].includes(actionArg) ? actionArg : 'ANALYZE',
      timeframe,
      source: 'TradingView CLI'
    });
    console.log(`✅ Analyzed ${symbol} (${timeframe}) | Last Price: $${state.lastPrice.toFixed(2)}`);
    console.log(`📊 Signal: ${state.lastSignal?.type} — ${state.lastSignal?.reason}`);
    console.log(`💼 Paper Equity: $${state.equity.toFixed(2)} | Cash: $${state.cashBalance.toFixed(2)}`);
    if (state.position) {
      console.log(`📌 Open Position: LONG ${state.position.amount.toFixed(4)} ${state.position.symbol} @ $${state.position.entryPrice.toFixed(2)}`);
    }
    return;
  }

  if (command === 'market') {
    console.log(`Fetching latest market ticker...`);
    const ticker = await exchange.fetchTicker(symbol);
    console.log(`Last Price: $${ticker.last?.toLocaleString()}`);
    console.log(`24h High:   $${ticker.high?.toLocaleString()}`);
    console.log(`24h Low:    $${ticker.low?.toLocaleString()}`);
    console.log(`24h Volume: ${ticker.baseVolume?.toLocaleString()} ${symbol.split('/')[0]}`);
    return;
  }

  if (command === 'paper') {
    console.log(`🤖 Starting Live Paper Trading Worker (${strategyArg})...`);
    const trader = new PaperTrader('binance');
    await trader.start({ symbol, timeframe, strategyId: strategyArg, pollIntervalMs: 15000 });
    setInterval(() => {
      const state = trader.getState();
      const latestLog = state.logs[0];
      console.log(
        `[${new Date().toLocaleTimeString()}] Equity: $${state.equity.toFixed(2)} | Price: $${state.lastPrice.toFixed(2)} | ${latestLog?.message || ''}`
      );
    }, 15000);
    return;
  }

  if (command === 'backtest' || command === 'test') {
    console.log(`📥 Downloading historical ${timeframe} candles from Binance...`);
    const candles = await exchange.fetchCandles(symbol, timeframe, 500);
    console.log(`Loaded ${candles.length} historical candles.\n`);

    const strategies = STRATEGY_CATALOG.map(meta => createStrategy(meta.id));

    const resultsTable = new Table({
      head: ['Strategy Engine', 'Initial $', 'Final $', 'PnL ($)', 'Return (%)', 'Trades', 'Win Rate', 'Profit Factor', 'Max DD'],
      colWidths: [38, 12, 12, 12, 12, 10, 12, 15, 10]
    });

    for (const strat of strategies) {
      const engine = new BacktestEngine(strat, 10000, 2.0, true);
      const res = engine.run(candles, symbol);

      resultsTable.push([
        res.strategyName,
        `$${res.initialBalance.toFixed(0)}`,
        `$${res.finalBalance.toFixed(2)}`,
        `${res.totalPnl >= 0 ? '+' : ''}$${res.totalPnl.toFixed(2)}`,
        `${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%`,
        res.totalTrades.toString(),
        `${res.winRate.toFixed(1)}%`,
        res.profitFactor.toString(),
        `${res.maxDrawdownPercent.toFixed(1)}%`
      ]);
    }

    console.log(resultsTable.toString());

    console.log(`\n📊 Real-Time Market Analysis (Price: $${candles[candles.length - 1].close.toLocaleString()}):`);
    for (const strat of strategies) {
      const signal = strat.analyze(candles);
      console.log(`- [${strat.name}]: ${signal.type} | Reason: ${signal.reason}`);
    }
  }
}

main().catch(err => {
  console.error('Error running trading-worker:', err.message);
  process.exit(1);
});
