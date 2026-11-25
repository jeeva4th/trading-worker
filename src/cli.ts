import Table from 'cli-table3';
import { ExchangeConnector } from './connectors/exchange';
import { TrendFollowingStrategy } from './strategies/trendFollowing';
import { MeanReversionStrategy } from './strategies/meanReversion';
import { BacktestEngine } from './engine/backtester';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'backtest';
  const symbol = args[1] || 'BTC/USDT';
  const timeframe = args[2] || '1h';

  const exchange = new ExchangeConnector('binance');

  console.log(`\n========================================`);
  console.log(`🚀 Trading Worker [CCXT + Top Strategies]`);
  console.log(`Exchange: ${exchange.getExchangeName()} | Pair: ${symbol} | Timeframe: ${timeframe}`);
  console.log(`========================================\n`);

  if (command === 'market') {
    console.log(`Fetching latest market ticker...`);
    const ticker = await exchange.fetchTicker(symbol);
    console.log(`Last Price: $${ticker.last?.toLocaleString()}`);
    console.log(`24h High:   $${ticker.high?.toLocaleString()}`);
    console.log(`24h Low:    $${ticker.low?.toLocaleString()}`);
    console.log(`24h Volume: ${ticker.baseVolume?.toLocaleString()} ${symbol.split('/')[0]}`);
    return;
  }

  if (command === 'backtest' || command === 'test') {
    console.log(`📥 Downloading historical ${timeframe} candles from Binance...`);
    const candles = await exchange.fetchCandles(symbol, timeframe, 300);
    console.log(`Loaded ${candles.length} historical candles.\n`);

    const strategies = [
      new TrendFollowingStrategy(9, 21, 14),
      new MeanReversionStrategy(20, 2, 14)
    ];

    const resultsTable = new Table({
      head: ['Strategy', 'Initial $', 'Final $', 'PnL ($)', 'Return (%)', 'Trades', 'Win Rate', 'Profit Factor', 'Max DD'],
      colWidths: [32, 12, 12, 12, 12, 10, 12, 15, 10]
    });

    for (const strat of strategies) {
      const engine = new BacktestEngine(strat, 10000, 2.0);
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

    // Print latest live signal
    console.log(`\n📊 Current Real-Time Signal (Last Candle: $${candles[candles.length - 1].close.toLocaleString()}):`);
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
