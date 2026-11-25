import { Strategy, Candle, TradeSignal } from '../types';
import { TechnicalIndicators } from '../indicators';

export class TrendFollowingStrategy implements Strategy {
  name = 'EMA Trend-Following + RSI Momentum';

  constructor(
    private fastPeriod: number = 9,
    private slowPeriod: number = 21,
    private rsiPeriod: number = 14
  ) {}

  analyze(candles: Candle[]): TradeSignal {
    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const fastEma = TechnicalIndicators.getEMA(candles, this.fastPeriod);
    const slowEma = TechnicalIndicators.getEMA(candles, this.slowPeriod);
    const rsi = TechnicalIndicators.getRSI(candles, this.rsiPeriod);
    const atr = TechnicalIndicators.getATR(candles, 14);

    if (fastEma.length < 2 || slowEma.length < 2 || rsi.length < 2) {
      return { type: 'HOLD', price: current.close, timestamp: current.timestamp, reason: 'Insufficient indicator data' };
    }

    const currentFast = fastEma[fastEma.length - 1];
    const prevFast = fastEma[fastEma.length - 2];
    const currentSlow = slowEma[slowEma.length - 1];
    const prevSlow = slowEma[slowEma.length - 2];
    const currentRsi = rsi[rsi.length - 1];
    const currentAtr = atr[atr.length - 1] || (current.close * 0.02);

    // Bullish Crossover: Fast EMA crosses above Slow EMA and RSI > 50
    const isBullishCross = prevFast <= prevSlow && currentFast > currentSlow;
    // Bearish Crossover: Fast EMA crosses below Slow EMA or RSI breaks below 45
    const isBearishCross = prevFast >= prevSlow && currentFast < currentSlow;

    if (isBullishCross && currentRsi > 50 && currentRsi < 75) {
      const stopLoss = current.close - (1.5 * currentAtr);
      const takeProfit = current.close + (3.0 * currentAtr);
      return {
        type: 'BUY',
        price: current.close,
        timestamp: current.timestamp,
        reason: `EMA Golden Cross (${this.fastPeriod}/${this.slowPeriod}) with RSI ${currentRsi.toFixed(1)}`,
        stopLoss,
        takeProfit
      };
    }

    if (isBearishCross || currentRsi > 80) {
      return {
        type: 'SELL',
        price: current.close,
        timestamp: current.timestamp,
        reason: `EMA Death Cross or RSI Overbought (${currentRsi.toFixed(1)})`
      };
    }

    return { type: 'HOLD', price: current.close, timestamp: current.timestamp, reason: 'No crossover trigger' };
  }
}
