import { Strategy, Candle, TradeSignal } from '../types';
import { TechnicalIndicators } from '../indicators';

export class AdaptiveRegimeStrategy implements Strategy {
  name = 'Adaptive Regime (ADX + 200 EMA + ATR)';

  constructor(
    private adxPeriod: number = 14,
    private trendEmaPeriod: number = 200,
    private fastEmaPeriod: number = 9,
    private slowEmaPeriod: number = 21
  ) {}

  analyze(candles: Candle[]): TradeSignal {
    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const ema200 = TechnicalIndicators.getEMA(candles, this.trendEmaPeriod);
    const fastEma = TechnicalIndicators.getEMA(candles, this.fastEmaPeriod);
    const slowEma = TechnicalIndicators.getEMA(candles, this.slowPeriod);
    const adxResults = TechnicalIndicators.getADX(candles, this.adxPeriod);
    const rsi = TechnicalIndicators.getRSI(candles, 14);
    const atr = TechnicalIndicators.getATR(candles, 14);
    const bands = TechnicalIndicators.getBollingerBands(candles, 20, 2);

    if (
      ema200.length < 2 ||
      fastEma.length < 2 ||
      slowEma.length < 2 ||
      adxResults.length < 2 ||
      rsi.length < 2 ||
      atr.length < 2 ||
      bands.length < 2
    ) {
      return { type: 'HOLD', price: current.close, timestamp: current.timestamp, reason: 'Calibrating indicators' };
    }

    const currentEma200 = ema200[ema200.length - 1];
    const currentFast = fastEma[fastEma.length - 1];
    const prevFast = fastEma[fastEma.length - 2];
    const currentSlow = slowEma[slowEma.length - 1];
    const prevSlow = slowEma[slowEma.length - 2];
    const currentAdx = adxResults[adxResults.length - 1].adx;
    const currentRsi = rsi[rsi.length - 1];
    const currentAtr = atr[atr.length - 1];
    const currentBand = bands[bands.length - 1];

    // REGIME 1: Strong Bullish Trend (ADX > 22 AND Price > 200 EMA)
    if (currentAdx > 22 && current.close > currentEma200) {
      // Pullback trigger: Fast EMA crossed Slow EMA or bounced with healthy RSI
      const isCross = prevFast <= prevSlow && currentFast > currentSlow;
      const isPullbackBounce = current.low <= currentSlow && current.close > currentSlow && currentRsi > 45 && currentRsi < 68;

      if (isCross || isPullbackBounce) {
        return {
          type: 'BUY',
          price: current.close,
          timestamp: current.timestamp,
          reason: `Trend Regime: ADX ${currentAdx.toFixed(1)} > 22 & Above 200 EMA (${currentEma200.toFixed(0)})`,
          stopLoss: current.close - (2.0 * currentAtr),
          takeProfit: current.close + (4.0 * currentAtr) // 1:2 R/R
        };
      }

      // Exit if trend breaks
      if (currentFast < currentSlow && currentRsi < 42) {
        return {
          type: 'SELL',
          price: current.close,
          timestamp: current.timestamp,
          reason: 'Trend exhaustion: Fast EMA crossed below Slow EMA'
        };
      }
    }

    // REGIME 2: Ranging / Mean-Reverting (ADX < 18)
    if (currentAdx < 18) {
      // Buy deep oversold bounce inside channel
      if (current.close <= currentBand.lower && currentRsi < 32) {
        return {
          type: 'BUY',
          price: current.close,
          timestamp: current.timestamp,
          reason: `Range Regime: ADX ${currentAdx.toFixed(1)} < 18, Lower BB bounce & RSI ${currentRsi.toFixed(1)}`,
          stopLoss: current.close - (1.5 * currentAtr),
          takeProfit: currentBand.middle
        };
      }

      if (current.close >= currentBand.upper || currentRsi > 68) {
        return {
          type: 'SELL',
          price: current.close,
          timestamp: current.timestamp,
          reason: `Range Target Hit: Upper BB / RSI Overbought (${currentRsi.toFixed(1)})`
        };
      }
    }

    // REGIME 3: Chop / Transition Zone (18 <= ADX <= 22) -> PRESERVE CAPITAL
    return {
      type: 'HOLD',
      price: current.close,
      timestamp: current.timestamp,
      reason: `Market in chop/transition (ADX: ${currentAdx.toFixed(1)}). Capital preserved.`
    };
  }

  private get slowPeriod(): number {
    return this.slowEmaPeriod;
  }
}
