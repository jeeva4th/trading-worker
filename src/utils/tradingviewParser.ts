export interface ParsedTradingViewInput {
  exchange: string;
  symbol: string;
  timeframe?: string;
  rawInput: string;
}

const KNOWN_QUOTES = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'USD'];

export function normalizeSymbolPair(rawPair: string): string {
  const cleaned = rawPair.trim().toUpperCase().replace(/[^A-Z0-9/:_-]/g, '');

  // Strip exchange prefix like BINANCE:BTCUSDT or OANDA:XAUUSD
  const withoutExchange = cleaned.includes(':') ? cleaned.split(':').pop() || cleaned : cleaned;

  if (['XAUUSD', 'XAU/USD', 'XAUUSDT', 'XAU/USDT', 'GOLD'].includes(withoutExchange)) {
    return 'XAU/USD';
  }

  if (withoutExchange.includes('/')) {
    return withoutExchange;
  }
  if (withoutExchange.includes('-') || withoutExchange.includes('_')) {
    return withoutExchange.replace(/[-_]/g, '/');
  }

  for (const quote of KNOWN_QUOTES) {
    if (withoutExchange.endsWith(quote) && withoutExchange.length > quote.length) {
      const base = withoutExchange.slice(0, withoutExchange.length - quote.length);
      // Map USD on TradingView crypto charts to USDT on Binance spot when applicable
      const normalizedQuote = quote === 'USD' ? 'USDT' : quote;
      return `${base}/${normalizedQuote}`;
    }
  }

  return `${withoutExchange}/USDT`;
}

export function parseTradingViewInput(input: string): ParsedTradingViewInput {
  const trimmed = input.trim();
  let exchange = 'binance';
  let symbolToken = trimmed;
  let timeframe: string | undefined;

  // Handle TradingView URLs like:
  // https://www.tradingview.com/chart/?symbol=BINANCE:ETHUSDT&interval=60
  // https://www.tradingview.com/symbols/SOLUSDT/
  // https://in.tradingview.com/symbols/BINANCE-BTCUSDT/
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const querySymbol = parsed.searchParams.get('symbol');
      const queryInterval = parsed.searchParams.get('interval');

      if (queryInterval) {
        const tfMap: Record<string, string> = {
          '1': '1m',
          '5': '5m',
          '15': '15m',
          '30': '30m',
          '60': '1h',
          '240': '4h',
          D: '1d',
          '1D': '1d'
        };
        timeframe = tfMap[queryInterval] || undefined;
      }

      if (querySymbol) {
        symbolToken = querySymbol;
      } else {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const symIndex = parts.findIndex(p => p.toLowerCase() === 'symbols');
        if (symIndex >= 0 && parts[symIndex + 1]) {
          symbolToken = parts[symIndex + 1];
        }
      }
    } catch {
      // Fallback to raw token parsing
    }
  }

  if (symbolToken.includes(':')) {
    const [exch, pair] = symbolToken.split(':');
    if (exch) {
      const lowerExch = exch.toLowerCase();
      if (['binance', 'bybit', 'okx', 'kraken', 'coinbase'].includes(lowerExch)) {
        exchange = lowerExch;
      }
    }
    symbolToken = pair || symbolToken;
  } else if (symbolToken.includes('-') && !symbolToken.includes('/')) {
    // Handle URL path format like BINANCE-BTCUSDT
    const [maybeExch, maybePair] = symbolToken.split('-');
    if (maybePair && ['binance', 'bybit', 'okx', 'kraken', 'coinbase'].includes(maybeExch.toLowerCase())) {
      exchange = maybeExch.toLowerCase();
      symbolToken = maybePair;
    }
  }

  return {
    exchange,
    symbol: normalizeSymbolPair(symbolToken),
    timeframe,
    rawInput: input
  };
}
