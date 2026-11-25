import { EMA, RSI, BollingerBands, ATR, ADX, MACD } from 'technicalindicators';
import { Candle } from '../types';

export interface VwapPoint {
  timestamp: number;
  vwap: number;
  upper: number;
  lower: number;
}

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

  /**
   * Computes daily UTC-anchored VWAP (or rolling 24-candle VWAP if daily candles)
   * along with +/- 1.5 sigma standard deviation bands.
   */
  static getSessionVWAP(candles: Candle[]): VwapPoint[] {
    if (candles.length === 0) return [];

    const avgStepMs = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 3600000;
    const isDailyOrHigher = avgStepMs >= 20 * 3600 * 1000;

    let currentDay = '';
    let cumPV = 0;
    let cumVol = 0;
    let cumPV2 = 0;

    const results: VwapPoint[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const vol = c.volume > 0 ? c.volume : 1;

      if (isDailyOrHigher) {
        const start = Math.max(0, i - 19);
        let pv = 0;
        let v = 0;
        let pv2 = 0;
        for (let j = start; j <= i; j++) {
          const cj = candles[j];
          const tpj = (cj.high + cj.low + cj.close) / 3;
          const vj = cj.volume > 0 ? cj.volume : 1;
          pv += tpj * vj;
          v += vj;
          pv2 += tpj * tpj * vj;
        }
        const vwap = pv / v;
        const variance = Math.max(0, pv2 / v - vwap * vwap);
        const std = Math.sqrt(variance);
        results.push({
          timestamp: c.timestamp,
          vwap,
          upper: vwap + 1.5 * std,
          lower: vwap - 1.5 * std
        });
      } else {
        const dayKey = new Date(c.timestamp).toISOString().slice(0, 10);
        if (dayKey !== currentDay) {
          currentDay = dayKey;
          cumPV = 0;
          cumVol = 0;
          cumPV2 = 0;
        }
        cumPV += typicalPrice * vol;
        cumVol += vol;
        cumPV2 += typicalPrice * typicalPrice * vol;

        const vwap = cumPV / cumVol;
        const variance = Math.max(0, cumPV2 / cumVol - vwap * vwap);
        const std = Math.sqrt(variance);
        results.push({
          timestamp: c.timestamp,
          vwap,
          upper: vwap + 1.5 * std,
          lower: vwap - 1.5 * std
        });
      }
    }

    return results;
  }
}
