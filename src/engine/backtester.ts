import { Strategy, Candle, Position, TradeRecord, BacktestResult } from '../types';
import { TechnicalIndicators } from '../indicators';

export class BacktestEngine {
  constructor(
    private strategy: Strategy,
    private initialBalance: number = 10000,
    private riskPerTradePercent: number = 2.0,
    private useTrailingStop: boolean = true
  ) {}

  run(candles: Candle[], symbol: string): BacktestResult {
    let balance = this.initialBalance;
    let peakBalance = this.initialBalance;
    let maxDrawdown = 0;
    let position: (Position & { highestSinceEntry?: number }) | null = null;
    const trades: TradeRecord[] = [];

    const atrValues = TechnicalIndicators.getATR(candles, 14);

    // Warm-up window of 50 candles for 200 EMA & indicators
    const warmUp = Math.min(60, Math.floor(candles.length / 4));

    for (let i = warmUp; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const currentCandle = candles[i];
      const currentAtr = atrValues[i] || (currentCandle.close * 0.02);
      const signal = this.strategy.analyze(slice);

      // 1. Manage Active Position
      if (position) {
        // Update highest price seen since entry for trailing stop
        if (!position.highestSinceEntry || currentCandle.high > position.highestSinceEntry) {
          position.highestSinceEntry = currentCandle.high;
        }

        // Dynamic Chandelier Trailing Stop
        if (this.useTrailingStop) {
          const trailingStop = position.highestSinceEntry - (1.8 * currentAtr);
          if (position.stopLoss === undefined || trailingStop > position.stopLoss) {
            position.stopLoss = trailingStop;
          }
        }

        let shouldExit = false;
        let exitReason = '';

        if (position.stopLoss && currentCandle.low <= position.stopLoss) {
          shouldExit = true;
          exitReason = 'Trailing Stop Hit';
        } else if (position.takeProfit && currentCandle.high >= position.takeProfit) {
          shouldExit = true;
          exitReason = 'Take Profit Target Reached';
        } else if (signal.type === 'SELL') {
          shouldExit = true;
          exitReason = signal.reason;
        }

        if (shouldExit) {
          const exitPrice = currentCandle.close;
          const pnl = (exitPrice - position.entryPrice) * position.amount;
          const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

          balance += (position.amount * position.entryPrice) + pnl;

          trades.push({
            entryTime: position.entryTime,
            exitTime: currentCandle.timestamp,
            entryPrice: position.entryPrice,
            exitPrice,
            amount: position.amount,
            pnl,
            pnlPercent,
            type: 'LONG',
            exitReason
          });

          position = null;
        }
      }

      // 2. Evaluate New Entry
      if (!position && signal.type === 'BUY') {
        const capitalToRisk = balance * (this.riskPerTradePercent / 100);
        // Volatility-adjusted sizing
        const stopDistance = signal.stopLoss ? Math.abs(signal.price - signal.stopLoss) : (currentAtr * 2);
        const sharesToBuy = stopDistance > 0 ? capitalToRisk / stopDistance : 0;
        const totalCost = sharesToBuy * signal.price;

        // Allocate up to 95% of available liquid cash
        const maxCapital = balance * 0.95;
        const allocatedCapital = Math.min(maxCapital, Math.max(balance * 0.25, totalCost));
        const amount = allocatedCapital / signal.price;

        if (amount > 0 && balance >= allocatedCapital) {
          balance -= allocatedCapital;
          position = {
            symbol,
            entryPrice: signal.price,
            amount,
            entryTime: currentCandle.timestamp,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            highestSinceEntry: signal.price
          };
        }
      }

      // 3. Track Equity Curve & Drawdown
      const currentEquity = balance + (position ? position.amount * currentCandle.close : 0);
      if (currentEquity > peakBalance) peakBalance = currentEquity;
      const drawdown = ((peakBalance - currentEquity) / peakBalance) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Close remaining open position at backtest end
    if (position) {
      const lastCandle = candles[candles.length - 1];
      const pnl = (lastCandle.close - position.entryPrice) * position.amount;
      const pnlPercent = ((lastCandle.close - position.entryPrice) / position.entryPrice) * 100;
      balance += (position.amount * position.entryPrice) + pnl;
      trades.push({
        entryTime: position.entryTime,
        exitTime: lastCandle.timestamp,
        entryPrice: position.entryPrice,
        exitPrice: lastCandle.close,
        amount: position.amount,
        pnl,
        pnlPercent,
        type: 'LONG',
        exitReason: 'Backtest Period Ended'
      });
    }

    const winning = trades.filter(t => t.pnl > 0);
    const losing = trades.filter(t => t.pnl <= 0);
    const grossProfit = winning.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(losing.reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99.9 : 0) : grossProfit / grossLoss;

    return {
      symbol,
      strategyName: this.strategy.name,
      initialBalance: this.initialBalance,
      finalBalance: balance,
      totalPnl: balance - this.initialBalance,
      totalPnlPercent: ((balance - this.initialBalance) / this.initialBalance) * 100,
      totalTrades: trades.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate: trades.length === 0 ? 0 : (winning.length / trades.length) * 100,
      profitFactor: Number(profitFactor.toFixed(2)),
      maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
      trades
    };
  }
}
