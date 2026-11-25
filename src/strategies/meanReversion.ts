import { Strategy, Candle, TradeSignal } from '../types';
import { TechnicalIndicators } from '../indicators';

export class MeanReversionStrategy implements Strategy {
  name = 'Bollinger Bands + RSI Mean Reversion';

  constructor(
    private bbPeriod: number = 20,
    private bbStdDev: number = 2,
    private rsiPeriod: number = 14
  ) {}

  analyze(candles: Candle[]): TradeSignal {
    const current = candles[candles.length - 1];
    const bands = TechnicalIndicators.getBollingerBands(candles, this.bbPeriod, this.bbStdDev);
    const rsi = TechnicalIndicators.getRSI(candles, this.rsiPeriod);

    if (bands.length === 0 || rsi.length === 0) {
      return { type: 'HOLD', price: current.close, timestamp: current.timestamp, reason: 'Insufficient data' };
    }

    const currentBand = bands[bands.length - 1];
    const currentRsi = rsi[rsi.length - 1];

    // Oversold: Price touches/drops below lower band and RSI < 35
    if (current.close <= currentBand.lower && currentRsi < 35) {
      return {
        type: 'BUY',
        price: current.close,
        timestamp: current.timestamp,
        reason: `Price below Lower BB (${currentBand.lower.toFixed(2)}) & RSI Oversold (${currentRsi.toFixed(1)})`,
        stopLoss: current.close * 0.98,
        takeProfit: currentBand.middle
      };
    }

    // Overbought: Price touches/exceeds upper band or middle band target reached with RSI > 65
    if (current.close >= currentBand.upper || currentRsi > 70) {
      return {
        type: 'SELL',
        price: current.close,
        timestamp: current.timestamp,
        reason: `Price hit Upper BB (${currentBand.upper.toFixed(2)}) & RSI Overbought (${currentRsi.toFixed(1)})`
      };
    }

    return { type: 'HOLD', price: current.close, timestamp: current.timestamp, reason: 'Within normal band range' };
  }
}
