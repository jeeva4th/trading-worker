import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { ExchangeConnector } from './connectors/exchange';
import { TechnicalIndicators } from './indicators';
import { BacktestEngine } from './engine/backtester';
import { PaperTrader } from './engine/paperTrader';
import { createStrategy, STRATEGY_CATALOG } from './strategies';
import { Candle, StrategyId } from './types';
import { parseTradingViewInput } from './utils/tradingviewParser';

const PORT = Number(process.env.PORT || 3000);
const WEB_DIR = path.join(process.cwd(), 'web');

const exchange = new ExchangeConnector('binance');
const paperTrader = new PaperTrader('binance');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        // Support plain text webhook payloads like "BUY BINANCE:BTCUSDT"
        resolve({ rawText: body.trim() });
      }
    });
    req.on('error', reject);
  });
}

function alignSeries(candles: Candle[], values: number[]): { time: number; value: number }[] {
  const offset = candles.length - values.length;
  return values.map((value, idx) => ({
    time: Math.floor(candles[idx + offset].timestamp / 1000),
    value: Number(value.toFixed(4))
  }));
}

function classifyRegime(adx: number, close: number, ema200: number | null) {
  if (adx > 22) {
    if (ema200 !== null && close > ema200) {
      return { regime: 'BULLISH TREND', badge: 'trend-up' };
    }
    if (ema200 !== null && close < ema200) {
      return { regime: 'BEARISH TREND', badge: 'trend-down' };
    }
    return { regime: 'TRENDING', badge: 'trend-up' };
  }
  if (adx < 18) {
    return { regime: 'RANGING / MEAN REVERSION', badge: 'range' };
  }
  return { regime: 'CHOP / CAPITAL PROTECTED', badge: 'chop' };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;

  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, exchange: exchange.getExchangeName(), timestamp: Date.now() });
      return true;
    }

    if (url.pathname === '/api/strategies' && req.method === 'GET') {
      sendJson(res, 200, { strategies: STRATEGY_CATALOG });
      return true;
    }

    if (url.pathname === '/api/market' && req.method === 'GET') {
      const symbol = url.searchParams.get('symbol') || 'BTC/USDT';
      const timeframe = url.searchParams.get('timeframe') || '1h';
      const strategyId = (url.searchParams.get('strategy') || 'adaptive') as StrategyId;
      const limit = Math.min(Number(url.searchParams.get('limit') || 350), 1000);

      const [candles, ticker] = await Promise.all([
        exchange.fetchCandles(symbol, timeframe, limit),
        exchange.fetchTicker(symbol)
      ]);

      const ema9 = TechnicalIndicators.getEMA(candles, 9);
      const ema21 = TechnicalIndicators.getEMA(candles, 21);
      const ema200 = TechnicalIndicators.getEMA(candles, 200);
      const adxList = TechnicalIndicators.getADX(candles, 14);
      const rsiList = TechnicalIndicators.getRSI(candles, 14);
      const atrList = TechnicalIndicators.getATR(candles, 14);

      const strategy = createStrategy(strategyId);
      const signal = strategy.analyze(candles);

      const latestCandle = candles[candles.length - 1];
      const latestAdx = adxList.length > 0 ? adxList[adxList.length - 1].adx : 0;
      const latestRsi = rsiList.length > 0 ? rsiList[rsiList.length - 1] : 50;
      const latestAtr = atrList.length > 0 ? atrList[atrList.length - 1] : 0;
      const latestEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;
      const regimeInfo = classifyRegime(latestAdx, latestCandle.close, latestEma200);

      sendJson(res, 200, {
        symbol,
        timeframe,
        strategyId,
        strategyName: strategy.name,
        candles: candles.map(c => ({
          time: Math.floor(c.timestamp / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        })),
        indicators: {
          ema9: alignSeries(candles, ema9),
          ema21: alignSeries(candles, ema21),
          ema200: alignSeries(candles, ema200)
        },
        metrics: {
          adx: Number(latestAdx.toFixed(2)),
          rsi: Number(latestRsi.toFixed(2)),
          atr: Number(latestAtr.toFixed(4)),
          ema200: latestEma200 ? Number(latestEma200.toFixed(2)) : null,
          regime: regimeInfo.regime,
          regimeBadge: regimeInfo.badge
        },
        ticker: {
          last: ticker.last ?? latestCandle.close,
          changePercent: ticker.percentage ?? 0,
          high: ticker.high ?? latestCandle.high,
          low: ticker.low ?? latestCandle.low,
          volume: ticker.baseVolume ?? 0
        },
        signal
      });
      return true;
    }

    if (url.pathname === '/api/tv/analyze' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const input = String(body.urlOrSymbol || body.symbol || 'BTC/USDT');
      const parsed = parseTradingViewInput(input);
      const timeframe = body.timeframe || parsed.timeframe || '1h';
      const action = (body.action || 'ANALYZE') as 'BUY' | 'SELL' | 'CLOSE' | 'ANALYZE';

      const workerState = await paperTrader.executeTradingViewSignal({
        symbol: parsed.symbol,
        action,
        timeframe,
        source: 'TradingView URL'
      });

      sendJson(res, 200, {
        parsed,
        timeframe,
        workerState
      });
      return true;
    }

    if (url.pathname === '/api/webhook/tradingview' && req.method === 'POST') {
      const body = await readJsonBody(req);
      let rawSymbol = body.symbol || body.ticker || 'BTC/USDT';
      let action = String(body.action || body.side || body.signal || 'ANALYZE').toUpperCase();

      if (body.rawText && !body.symbol) {
        const tokens = String(body.rawText).split(/\s+/);
        if (tokens.length >= 2) {
          action = tokens[0].toUpperCase();
          rawSymbol = tokens[1];
        } else {
          rawSymbol = tokens[0];
        }
      }

      const validAction = ['BUY', 'SELL', 'CLOSE', 'ANALYZE'].includes(action)
        ? (action as 'BUY' | 'SELL' | 'CLOSE' | 'ANALYZE')
        : 'ANALYZE';

      const parsed = parseTradingViewInput(String(rawSymbol));
      const workerState = await paperTrader.executeTradingViewSignal({
        symbol: parsed.symbol,
        action: validAction,
        timeframe: body.timeframe || parsed.timeframe,
        source: 'TradingView Webhook'
      });

      sendJson(res, 200, {
        ok: true,
        received: { symbol: parsed.symbol, action: validAction },
        workerState
      });
      return true;
    }

    if (url.pathname === '/api/backtest' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const symbol = body.symbol || url.searchParams.get('symbol') || 'BTC/USDT';
      const timeframe = body.timeframe || url.searchParams.get('timeframe') || '1h';
      const strategyId = (body.strategy || url.searchParams.get('strategy') || 'adaptive') as StrategyId;
      const initialBalance = Number(body.initialBalance || url.searchParams.get('initialBalance') || 10000);
      const limit = Math.min(Number(body.limit || url.searchParams.get('limit') || 500), 1000);

      const candles = await exchange.fetchCandles(symbol, timeframe, limit);
      const strategy = createStrategy(strategyId);
      const engine = new BacktestEngine(strategy, initialBalance, 2.0, true);
      const result = engine.run(candles, symbol);

      sendJson(res, 200, {
        ...result,
        trades: result.trades.map(t => ({
          ...t,
          entryTimeSec: Math.floor(t.entryTime / 1000),
          exitTimeSec: Math.floor(t.exitTime / 1000)
        })),
        equityCurve: result.equityCurve.map(p => ({
          time: Math.floor(p.timestamp / 1000),
          value: p.equity
        }))
      });
      return true;
    }

    if (url.pathname === '/api/worker/status' && req.method === 'GET') {
      sendJson(res, 200, paperTrader.getState());
      return true;
    }

    if (url.pathname === '/api/worker/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const state = await paperTrader.start({
        symbol: body.symbol,
        timeframe: body.timeframe,
        strategyId: body.strategyId,
        pollIntervalMs: body.pollIntervalMs ? Number(body.pollIntervalMs) : undefined
      });
      sendJson(res, 200, state);
      return true;
    }

    if (url.pathname === '/api/worker/stop' && req.method === 'POST') {
      sendJson(res, 200, paperTrader.stop());
      return true;
    }

    if (url.pathname === '/api/worker/tick' && req.method === 'POST') {
      const state = await paperTrader.tick();
      sendJson(res, 200, state);
      return true;
    }

    if (url.pathname === '/api/worker/reset' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const state = paperTrader.reset(Number(body.initialBalance || 10000));
      sendJson(res, 200, state);
      return true;
    }

    sendJson(res, 404, { error: 'API endpoint not found' });
    return true;
  } catch (error: any) {
    sendJson(res, 500, { error: error?.message || 'Internal server error' });
    return true;
  }
}

function serveStatic(res: http.ServerResponse, url: URL): void {
  const safePath = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(WEB_DIR, safePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEB_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

export function startServer(port = PORT): http.Server {
  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const handled = await handleApi(req, res, reqUrl);
    if (!handled) {
      serveStatic(res, reqUrl);
    }
  });

  server.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`📈 Trading Worker + TradingView Terminal Running!`);
    console.log(`🌐 Web App URL:  http://localhost:${port}`);
    console.log(`🔗 TV Webhook:   http://localhost:${port}/api/webhook/tradingview`);
    console.log(`======================================================\n`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}
