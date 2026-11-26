import ccxt, { Exchange } from 'ccxt';
import { Candle } from '../types';

interface CachedCandles {
  expiresAt: number;
  data: Candle[];
}

export class ExchangeConnector {
  private spotExchange: Exchange;
  private futureExchange: Exchange;
  private exchangeId: string;
  private candleCache = new Map<string, CachedCandles>();

  constructor(exchangeId: string = 'binance') {
    this.exchangeId = exchangeId.toLowerCase();
    const ExchangeClass = (ccxt as any)[exchangeId];
    if (!ExchangeClass) {
      throw new Error(`Exchange ${exchangeId} not supported by CCXT.`);
    }

    this.spotExchange = new ExchangeClass({
      enableRateLimit: false,
      options: { defaultType: 'spot' }
    });

    this.futureExchange = new ExchangeClass({
      enableRateLimit: false,
      options: { defaultType: 'future' }
    });
  }

  private resolveTarget(symbol: string): { client: Exchange; marketSymbol: string; isFuture: boolean; restSymbol: string } {
    const upper = symbol.trim().toUpperCase();
    if (upper === 'XAU/USD' || upper === 'XAUUSD' || upper === 'XAU/USDT') {
      return { client: this.futureExchange, marketSymbol: 'XAU/USDT:USDT', isFuture: true, restSymbol: 'XAUUSDT' };
    }
    if (upper.includes(':')) {
      const clean = upper.split(':')[0].replace('/', '');
      return { client: this.futureExchange, marketSymbol: upper, isFuture: true, restSymbol: clean };
    }
    return { client: this.spotExchange, marketSymbol: upper, isFuture: false, restSymbol: upper.replace('/', '') };
  }

  async fetchFastKlines(symbol: string, timeframe: string, limit: number): Promise<Candle[] | null> {
    if (this.exchangeId !== 'binance') return null;
    const { isFuture, restSymbol } = this.resolveTarget(symbol);
    const base = isFuture
      ? 'https://fapi.binance.com/fapi/v1/klines'
      : 'https://api.binance.com/api/v3/klines';
    const url = `${base}?symbol=${encodeURIComponent(restSymbol)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = (await res.json()) as any[][];
    if (!Array.isArray(raw)) return null;

    return raw.map(row => ({
      timestamp: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));
  }

  async fetchFastPrice(symbol: string): Promise<number | null> {
    if (this.exchangeId !== 'binance') return null;
    const { isFuture, restSymbol } = this.resolveTarget(symbol);
    const base = isFuture
      ? 'https://fapi.binance.com/fapi/v1/ticker/price'
      : 'https://api.binance.com/api/v3/ticker/price';
    const res = await fetch(`${base}?symbol=${encodeURIComponent(restSymbol)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    return data.price ? Number(data.price) : null;
  }

  async fetchCandles(symbol: string = 'BTC/USDT', timeframe: string = '1h', limit: number = 200): Promise<Candle[]> {
    const cacheKey = `${symbol}:${timeframe}:${limit}`;
    const cached = this.candleCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    let candles = await this.fetchFastKlines(symbol, timeframe, limit).catch(() => null);
    if (!candles) {
      const { client, marketSymbol } = this.resolveTarget(symbol);
      const raw = await client.fetchOHLCV(marketSymbol, timeframe, undefined, limit);
      candles = raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: Number(timestamp),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume)
      }));
    }

    // Cache full historical queries briefly (4s) to avoid redundant downloads across endpoints
    if (limit >= 50) {
      this.candleCache.set(cacheKey, {
        expiresAt: Date.now() + 4000,
        data: candles
      });
    }

    return candles;
  }

  async fetchTicker(symbol: string = 'BTC/USDT') {
    const { client, marketSymbol, isFuture, restSymbol } = this.resolveTarget(symbol);
    if (this.exchangeId === 'binance') {
      try {
        const base = isFuture
          ? 'https://fapi.binance.com/fapi/v1/ticker/24hr'
          : 'https://api.binance.com/api/v3/ticker/24hr';
        const res = await fetch(`${base}?symbol=${encodeURIComponent(restSymbol)}`);
        if (res.ok) {
          const d = (await res.json()) as any;
          return {
            last: Number(d.lastPrice),
            percentage: Number(d.priceChangePercent),
            high: Number(d.highPrice),
            low: Number(d.lowPrice),
            baseVolume: Number(d.volume)
          };
        }
      } catch {
        // Fallback to CCXT below
      }
    }
    return await client.fetchTicker(marketSymbol);
  }

  getExchangeName(): string {
    return this.spotExchange.name || 'Exchange';
  }
}
