import ccxt, { Exchange } from 'ccxt';
import { Candle } from '../types';

export class ExchangeConnector {
  private spotExchange: Exchange;
  private futureExchange: Exchange;

  constructor(exchangeId: string = 'binance') {
    const ExchangeClass = (ccxt as any)[exchangeId];
    if (!ExchangeClass) {
      throw new Error(`Exchange ${exchangeId} not supported by CCXT.`);
    }

    this.spotExchange = new ExchangeClass({
      enableRateLimit: true,
      options: { defaultType: 'spot' }
    });

    this.futureExchange = new ExchangeClass({
      enableRateLimit: true,
      options: { defaultType: 'future' }
    });
  }

  private resolveTarget(symbol: string): { client: Exchange; marketSymbol: string } {
    const upper = symbol.trim().toUpperCase();
    if (upper === 'XAU/USD' || upper === 'XAUUSD' || upper === 'XAU/USDT') {
      return { client: this.futureExchange, marketSymbol: 'XAU/USDT:USDT' };
    }
    if (upper.includes(':')) {
      return { client: this.futureExchange, marketSymbol: upper };
    }
    return { client: this.spotExchange, marketSymbol: upper };
  }

  async fetchCandles(symbol: string = 'BTC/USDT', timeframe: string = '1h', limit: number = 200): Promise<Candle[]> {
    const { client, marketSymbol } = this.resolveTarget(symbol);
    const raw = await client.fetchOHLCV(marketSymbol, timeframe, undefined, limit);
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
    const { client, marketSymbol } = this.resolveTarget(symbol);
    return await client.fetchTicker(marketSymbol);
  }

  getExchangeName(): string {
    return this.spotExchange.name || 'Exchange';
  }
}
