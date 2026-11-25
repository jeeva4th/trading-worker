import { EMA, RSI, BollingerBands, ATR, ADX, MACD, VWAP } from 'technicalindicators';
import { Candle } from '../types';

export class TechnicalIndicators {
  static getEMA(candles: Candle[], period: number): number[] {
    const values = candles.map(c => c.close);
    return EMA.calculate({ period, values });
  }

  static getRSI(candles: Candle[], period: number = 14): number[] {
    const values = candles.map(c => c.close);
    return RSI.calculate({ period, values });
  }

  static getBollingerBands(candles: Candle[], period: number = 20, stdDev: number = 2) {
    const values = candles.map(c => c.close);
    return BollingerBands.calculate({ period, stdDev, values });
  }

  static getATR(candles: Candle[], period: number = 14): number[] {
    return ATR.calculate({
      high: candles.map(c => c.high),
      low: candles.map(c => c.low),
      close: candles.map(c => c.close),
      period
    });
  }

  static getADX(candles: Candle[], period: number = 14) {
    return ADX.calculate({
      high: candles.map(c => c.high),
      low: candles.map(c => c.low),
      close: candles.map(c => c.close),
      period
    });
  }

  static getMACD(candles: Candle[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const values = candles.map(c => c.close);
    return MACD.calculate({
      values,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
  }

  static getVolumeSMA(candles: Candle[], period: number = 20): number[] {
    const volumes = candles.map(c => c.volume);
    return EMA.calculate({ period, values: volumes });
  }
}
