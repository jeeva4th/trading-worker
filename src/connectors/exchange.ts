import ccxt, { Exchange } from 'ccxt';
import { Candle } from '../types';

export class ExchangeConnector {
  private exchange: Exchange;

  constructor(exchangeId: string = 'binance') {
    const ExchangeClass = (ccxt as any)[exchangeId];
    if (!ExchangeClass) {
      throw new Error(`Exchange ${exchangeId} not supported by CCXT.`);
    }

    this.exchange = new ExchangeClass({
      enableRateLimit: true,
      options: { defaultType: 'spot' }
    });
  }

  async fetchCandles(symbol: string = 'BTC/USDT', timeframe: string = '1h', limit: number = 200): Promise<Candle[]> {
    const raw = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return raw.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume)
    }));
  }

  async fetchTicker(symbol: string = 'BTC/USDT') {
    return await this.exchange.fetchTicker(symbol);
  }

  getExchangeName(): string {
    return this.exchange.name || 'Exchange';
  }
}
