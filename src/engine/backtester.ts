import { Strategy, Candle, Position, TradeRecord, BacktestResult } from '../types';

export class BacktestEngine {
  constructor(
    private strategy: Strategy,
    private initialBalance: number = 10000,
    private riskPerTradePercent: number = 2.0 // risk 2% of equity per trade
  ) {}

  run(candles: Candle[], symbol: string): BacktestResult {
    let balance = this.initialBalance;
    let peakBalance = this.initialBalance;
    let maxDrawdown = 0;
    let position: Position | null = null;
    const trades: TradeRecord[] = [];

    // Warm-up window of 30 candles for indicator stability
    const warmUp = 30;

    for (let i = warmUp; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const currentCandle = candles[i];
      const signal = this.strategy.analyze(slice);

      // Check current position exit conditions (Stop-Loss / Take-Profit)
      if (position) {
        let shouldExit = false;
        let exitReason = '';

        if (position.stopLoss && currentCandle.low <= position.stopLoss) {
          shouldExit = true;
          exitReason = 'Stop Loss Hit';
        } else if (position.takeProfit && currentCandle.high >= position.takeProfit) {
          shouldExit = true;
          exitReason = 'Take Profit Hit';
        } else if (signal.type === 'SELL') {
          shouldExit = true;
          exitReason = signal.reason;
        }

        if (shouldExit) {
          const exitPrice = currentCandle.close;
          const pnl = (exitPrice - position.entryPrice) * position.amount;
          const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

          balance += position.amount * position.entryPrice + pnl;

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

      // Check entry conditions
      if (!position && signal.type === 'BUY') {
        const capitalToRisk = balance * (this.riskPerTradePercent / 100);
        const positionCapital = Math.min(balance * 0.95, capitalToRisk * 5); // 5x leverage equivalent allocation or cash limit
        const amount = positionCapital / signal.price;

        if (amount > 0 && balance >= positionCapital) {
          balance -= positionCapital;
          position = {
            symbol,
            entryPrice: signal.price,
            amount,
            entryTime: currentCandle.timestamp,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit
          };
        }
      }

      // Track equity and max drawdown
      const currentEquity = balance + (position ? position.amount * currentCandle.close : 0);
      if (currentEquity > peakBalance) peakBalance = currentEquity;
      const drawdown = ((peakBalance - currentEquity) / peakBalance) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Close remaining open position at last candle
    if (position) {
      const lastCandle = candles[candles.length - 1];
      const pnl = (lastCandle.close - position.entryPrice) * position.amount;
      const pnlPercent = ((lastCandle.close - position.entryPrice) / position.entryPrice) * 100;
      balance += position.amount * position.entryPrice + pnl;
      trades.push({
        entryTime: position.entryTime,
        exitTime: lastCandle.timestamp,
        entryPrice: position.entryPrice,
        exitPrice: lastCandle.close,
        amount: position.amount,
        pnl,
        pnlPercent,
        type: 'LONG',
        exitReason: 'Backtest End Close'
      });
    }

    const winning = trades.filter(t => t.pnl > 0);
    const losing = trades.filter(t => t.pnl <= 0);
    const grossProfit = winning.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(losing.reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

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
