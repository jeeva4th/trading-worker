import { EMA, RSI, BollingerBands, ATR } from 'technicalindicators';
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
}
