import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { ExchangeConnector } from './connectors/exchange';
import { TechnicalIndicators } from './indicators';
import { BacktestEngine } from './engine/backtester';
import { PaperTrader } from './engine/paperTrader';
import { createStrategy, EmaVwapLiquidityStrategy, STRATEGY_CATALOG } from './strategies';
import { Candle, DEFAULT_STRATEGY_SETTINGS, StrategyId, StrategySettings } from './types';
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

function parseSettings(source: Record<string, any>): StrategySettings {
  return {
    fastEmaPeriod: Math.max(2, Number(source.fastEmaPeriod || source.fastEma || DEFAULT_STRATEGY_SETTINGS.fastEmaPeriod)),
    slowEmaPeriod: Math.max(5, Number(source.slowEmaPeriod || source.slowEma || DEFAULT_STRATEGY_SETTINGS.slowEmaPeriod)),
    macroEmaPeriod: Math.max(20, Number(source.macroEmaPeriod || source.macroEma || DEFAULT_STRATEGY_SETTINGS.macroEmaPeriod)),
    liquidityLookback: Math.max(5, Number(source.liquidityLookback || source.lookback || DEFAULT_STRATEGY_SETTINGS.liquidityLookback)),
    minWickRatio: Math.min(0.9, Math.max(0.05, Number(source.minWickRatio || source.minWick || DEFAULT_STRATEGY_SETTINGS.minWickRatio))),
    riskPerTradePercent: Math.min(10, Math.max(0.25, Number(source.riskPerTradePercent || source.risk || DEFAULT_STRATEGY_SETTINGS.riskPerTradePercent))),
    riskRewardRatio: Math.max(1.0, Number(source.riskRewardRatio || source.rr || DEFAULT_STRATEGY_SETTINGS.riskRewardRatio)),
    useTrailingStop: source.useTrailingStop !== undefined ? String(source.useTrailingStop) !== 'false' && source.useTrailingStop !== false : DEFAULT_STRATEGY_SETTINGS.useTrailingStop,
    initialBalance: Math.max(100, Number(source.initialBalance || DEFAULT_STRATEGY_SETTINGS.initialBalance))
  };
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
    return { regime: 'RANGING / LIQUIDITY PLAY', badge: 'range' };
  }
  return { regime: 'CHOP / SELECTIVE', badge: 'chop' };
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
      sendJson(res, 200, { strategies: STRATEGY_CATALOG, defaultSettings: DEFAULT_STRATEGY_SETTINGS });
      return true;
    }

    if (url.pathname === '/api/market' && req.method === 'GET') {
      const symbol = url.searchParams.get('symbol') || 'XAU/USD';
      const timeframe = url.searchParams.get('timeframe') || '1h';
      const strategyId = (url.searchParams.get('strategy') || 'ema_vwap_liquidity') as StrategyId;
      const limit = Math.min(Number(url.searchParams.get('limit') || 350), 1000);
      const settings = parseSettings(Object.fromEntries(url.searchParams.entries()));

      const [candles, ticker] = await Promise.all([
        exchange.fetchCandles(symbol, timeframe, limit),
        exchange.fetchTicker(symbol)
      ]);

      const emaFast = TechnicalIndicators.getEMA(candles, settings.fastEmaPeriod);
      const emaSlow = TechnicalIndicators.getEMA(candles, settings.slowEmaPeriod);
      const emaMacro = TechnicalIndicators.getEMA(candles, settings.macroEmaPeriod);
      const adxList = TechnicalIndicators.getADX(candles, 14);
      const rsiList = TechnicalIndicators.getRSI(candles, 14);
      const atrList = TechnicalIndicators.getATR(candles, 14);
      const vwapList = TechnicalIndicators.getSessionVWAP(candles);

      const strategy = createStrategy(strategyId, settings);
      const signal = strategy.analyze(candles);

      // Always compute EMA VWAP Liquidity setup diagnostics so Setups panel stays rich
      const liquidityDiagSignal = strategyId === 'ema_vwap_liquidity'
        ? signal
        : new EmaVwapLiquidityStrategy(settings).analyze(candles);

      const latestCandle = candles[candles.length - 1];
      const latestAdx = adxList.length > 0 ? adxList[adxList.length - 1].adx : 0;
      const latestRsi = rsiList.length > 0 ? rsiList[rsiList.length - 1] : 50;
      const latestAtr = atrList.length > 0 ? atrList[atrList.length - 1] : 0;
      const latestMacro = emaMacro.length > 0 ? emaMacro[emaMacro.length - 1] : null;
      const latestVwap = vwapList.length > 0 ? vwapList[vwapList.length - 1].vwap : latestCandle.close;
      const regimeInfo = classifyRegime(latestAdx, latestCandle.close, latestMacro);

      sendJson(res, 200, {
        symbol,
        timeframe,
        strategyId,
        strategyName: strategy.name,
        settings,
        candles: candles.map(c => ({
          time: Math.floor(c.timestamp / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        })),
        indicators: {
          emaFast: alignSeries(candles, emaFast),
          emaSlow: alignSeries(candles, emaSlow),
          emaMacro: alignSeries(candles, emaMacro),
          vwap: vwapList.map(v => ({ time: Math.floor(v.timestamp / 1000), value: Number(v.vwap.toFixed(4)) })),
          vwapUpper: vwapList.map(v => ({ time: Math.floor(v.timestamp / 1000), value: Number(v.upper.toFixed(4)) })),
          vwapLower: vwapList.map(v => ({ time: Math.floor(v.timestamp / 1000), value: Number(v.lower.toFixed(4)) })),
          rsiSeries: alignSeries(candles, rsiList),
          adxSeries: alignSeries(candles, adxList.map(a => a.adx))
        },
        metrics: {
          adx: Number(latestAdx.toFixed(2)),
          rsi: Number(latestRsi.toFixed(2)),
          atr: Number(latestAtr.toFixed(4)),
          ema200: latestMacro ? Number(latestMacro.toFixed(2)) : null,
          vwap: Number(latestVwap.toFixed(2)),
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
        signal,
        diagnostics: liquidityDiagSignal.diagnostics || null
      });
      return true;
    }

    if (url.pathname === '/api/mtf' && req.method === 'GET') {
      const symbol = url.searchParams.get('symbol') || 'XAU/USD';
      const tfs = ['15m', '1h', '4h', '1d'];
      const matrix = await Promise.all(
        tfs.map(async tf => {
          try {
            const candles = await exchange.fetchCandles(symbol, tf, 120);
            const ema9 = TechnicalIndicators.getEMA(candles, 9);
            const ema21 = TechnicalIndicators.getEMA(candles, 21);
            const rsi = TechnicalIndicators.getRSI(candles, 14);
            const adx = TechnicalIndicators.getADX(candles, 14);
            const vwap = TechnicalIndicators.getSessionVWAP(candles);
            const last = candles[candles.length - 1];
            const f = ema9[ema9.length - 1] ?? last.close;
            const s = ema21[ema21.length - 1] ?? last.close;
            const v = vwap[vwap.length - 1]?.vwap ?? last.close;
            const r = rsi[rsi.length - 1] ?? 50;
            const a = adx[adx.length - 1]?.adx ?? 0;

            let bias = 'NEUTRAL';
            if (f > s && last.close >= v) bias = 'BULLISH';
            else if (f < s && last.close < v) bias = 'BEARISH';

            return {
              timeframe: tf,
              bias,
              price: last.close,
              vwap: Number(v.toFixed(2)),
              rsi: Number(r.toFixed(1)),
              adx: Number(a.toFixed(1)),
              aboveVwap: last.close >= v,
              emaBullish: f >= s
            };
          } catch {
            return { timeframe: tf, bias: 'NEUTRAL', price: 0, vwap: 0, rsi: 50, adx: 0, aboveVwap: false, emaBullish: false };
          }
        })
      );
      sendJson(res, 200, { symbol, matrix });
      return true;
    }

    if (url.pathname === '/api/setups/scan' && req.method === 'GET') {
      const timeframe = url.searchParams.get('timeframe') || '1h';
      const settings = parseSettings(Object.fromEntries(url.searchParams.entries()));
      const pairs = ['XAU/USD', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
      const model = new EmaVwapLiquidityStrategy(settings);

      const setups = await Promise.all(
        pairs.map(async pair => {
          try {
            const candles = await exchange.fetchCandles(pair, timeframe, 260);
            const sig = model.analyze(candles);
            const last = candles[candles.length - 1];
            return {
              symbol: pair,
              timeframe,
              price: last.close,
              signal: sig.type,
              reason: sig.reason,
              diagnostics: sig.diagnostics || null
            };
          } catch (err: any) {
            return {
              symbol: pair,
              timeframe,
              price: 0,
              signal: 'HOLD',
              reason: err?.message || 'Unavailable',
              diagnostics: null
            };
          }
        })
      );

      setups.sort((a, b) => (b.diagnostics?.score || 0) - (a.diagnostics?.score || 0));
      sendJson(res, 200, { timeframe, setups });
      return true;
    }

    if (url.pathname === '/api/tv/analyze' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const input = String(body.urlOrSymbol || body.symbol || 'XAU/USD');
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
      let rawSymbol = body.symbol || body.ticker || 'XAU/USD';
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
      const symbol = body.symbol || url.searchParams.get('symbol') || 'XAU/USD';
      const timeframe = body.timeframe || url.searchParams.get('timeframe') || '1h';
      const strategyId = (body.strategy || url.searchParams.get('strategy') || 'ema_vwap_liquidity') as StrategyId;
      const limit = Math.min(Number(body.limit || url.searchParams.get('limit') || 500), 1000);
      const settings = parseSettings(body.settings ? { ...body, ...body.settings } : { ...Object.fromEntries(url.searchParams.entries()), ...body });

      const candles = await exchange.fetchCandles(symbol, timeframe, limit);
      const strategy = createStrategy(strategyId, settings);
      const engine = new BacktestEngine(
        strategy,
        settings.initialBalance,
        settings.riskPerTradePercent,
        settings.useTrailingStop
      );
      const result = engine.run(candles, symbol);

      sendJson(res, 200, {
        ...result,
        settings,
        trades: result.trades.map(t => ({
          ...t,
          entryTimeSec: Math.floor(t.entryTime / 1000),
          exitTimeSec: Math.floor(t.exitTime / 1000)
        })),
        equityCurve: result.equityCurve.map(p => ({
          time: Math.floor(p.timestamp / 1000),
          value: p.equity,
          drawdown: p.drawdownPercent ?? 0
        }))
      });
      return true;
    }

    if (url.pathname === '/api/worker/status' && req.method === 'GET') {
      sendJson(res, 200, paperTrader.getState());
      return true;
    }

    if (url.pathname === '/api/worker/configure' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const state = paperTrader.configure({
        symbol: body.symbol,
        timeframe: body.timeframe,
        strategyId: body.strategyId,
        pollIntervalMs: body.pollIntervalMs ? Number(body.pollIntervalMs) : undefined,
        settings: body.settings ? parseSettings(body.settings) : undefined
      });
      sendJson(res, 200, state);
      return true;
    }

    if (url.pathname === '/api/worker/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const state = await paperTrader.start({
        symbol: body.symbol,
        timeframe: body.timeframe,
        strategyId: body.strategyId,
        pollIntervalMs: body.pollIntervalMs ? Number(body.pollIntervalMs) : undefined,
        settings: body.settings ? parseSettings(body.settings) : undefined
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
    console.log(`📈 Trading Worker + TradingView Quant Dashboard Running!`);
    console.log(`🌐 Dashboard URL: http://localhost:${port}`);
    console.log(`🔗 TV Webhook:    http://localhost:${port}/api/webhook/tradingview`);
    console.log(`======================================================\n`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}
