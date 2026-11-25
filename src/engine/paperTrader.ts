import fs from 'fs';
import path from 'path';
import { ExchangeConnector } from '../connectors/exchange';
import { TechnicalIndicators } from '../indicators';
import { createStrategy } from '../strategies';
import { DEFAULT_STRATEGY_SETTINGS, Position, StrategyId, StrategySettings, TradeRecord, TradeSignal } from '../types';
import { normalizeSymbolPair } from '../utils/tradingviewParser';

export interface WorkerLog {
  timestamp: number;
  level: 'INFO' | 'SIGNAL' | 'TRADE' | 'WARN' | 'ERROR';
  message: string;
}

export interface PaperWorkerState {
  running: boolean;
  symbol: string;
  timeframe: string;
  strategyId: StrategyId;
  strategyName: string;
  settings: StrategySettings;
  initialBalance: number;
  cashBalance: number;
  lastPrice: number;
  equity: number;
  realizedPnl: number;
  winRate: number;
  maxDailyLossPercent: number;
  circuitBreakerTriggered: boolean;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  position: Position | null;
  trades: TradeRecord[];
  lastSignal: TradeSignal | null;
  lastTickAt: number | null;
  pollIntervalMs: number;
  logs: WorkerLog[];
}

export class PaperTrader {
  private exchange: ExchangeConnector;
  private state: PaperWorkerState;
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private stateFilePath: string;

  constructor(
    exchangeId = 'binance',
    stateDir = path.join(process.cwd(), 'data')
  ) {
    this.exchange = new ExchangeConnector(exchangeId);
    this.stateFilePath = path.join(stateDir, 'paper_state.json');

    const defaultState = this.createDefaultState('XAU/USD', '1h', 'ema_vwap_liquidity', 10000, 15000);
    this.state = this.loadState() || defaultState;
    if (!this.state.settings) {
      this.state.settings = { ...DEFAULT_STRATEGY_SETTINGS };
    }
    if (this.state.realizedPnl === undefined) this.state.realizedPnl = 0;
    if (this.state.winRate === undefined) this.state.winRate = 0;
    if (this.state.maxDailyLossPercent === undefined) this.state.maxDailyLossPercent = 5.0;
    if (this.state.circuitBreakerTriggered === undefined) this.state.circuitBreakerTriggered = false;
    // Always start paused on fresh boot unless explicitly started
    this.state.running = false;
  }

  private createDefaultState(
    symbol: string,
    timeframe: string,
    strategyId: StrategyId,
    initialBalance: number,
    pollIntervalMs: number
  ): PaperWorkerState {
    const strategy = createStrategy(strategyId);
    return {
      running: false,
      symbol,
      timeframe,
      strategyId,
      strategyName: strategy.name,
      settings: { ...DEFAULT_STRATEGY_SETTINGS },
      initialBalance,
      cashBalance: initialBalance,
      lastPrice: 0,
      equity: initialBalance,
      realizedPnl: 0,
      winRate: 0,
      maxDailyLossPercent: 5.0,
      circuitBreakerTriggered: false,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      position: null,
      trades: [],
      lastSignal: null,
      lastTickAt: null,
      pollIntervalMs,
      logs: [
        {
          timestamp: Date.now(),
          level: 'INFO',
          message: `Paper Worker initialized (${symbol} ${timeframe}, $${initialBalance.toLocaleString()} virtual capital).`
        }
      ]
    };
  }

  private loadState(): PaperWorkerState | null {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(raw) as PaperWorkerState;
      }
    } catch {
      // Ignore corrupt state file and start fresh
    }
    return null;
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // Non-fatal persistence error
    }
  }

  private appendLog(level: WorkerLog['level'], message: string): void {
    this.state.logs.unshift({
      timestamp: Date.now(),
      level,
      message
    });
    if (this.state.logs.length > 80) {
      this.state.logs = this.state.logs.slice(0, 80);
    }
  }

  getState(): PaperWorkerState {
    return { ...this.state };
  }

  configure(options: {
    symbol?: string;
    timeframe?: string;
    strategyId?: StrategyId;
    pollIntervalMs?: number;
    settings?: Partial<StrategySettings>;
  }): PaperWorkerState {
    if (options.symbol) this.state.symbol = options.symbol;
    if (options.timeframe) this.state.timeframe = options.timeframe;
    if (options.settings) {
      this.state.settings = { ...this.state.settings, ...options.settings };
    }
    if (options.strategyId) {
      this.state.strategyId = options.strategyId;
      this.state.strategyName = createStrategy(options.strategyId, this.state.settings).name;
    }
    if (options.pollIntervalMs && options.pollIntervalMs >= 3000) {
      this.state.pollIntervalMs = options.pollIntervalMs;
    }
    this.appendLog(
      'INFO',
      `Worker configured: ${this.state.symbol} (${this.state.timeframe}) using ${this.state.strategyName}`
    );
    this.saveState();
    return this.getState();
  }

  reset(initialBalance = 10000): PaperWorkerState {
    const wasRunning = this.state.running;
    if (wasRunning) this.stop();
    this.state = this.createDefaultState(
      this.state.symbol,
      this.state.timeframe,
      this.state.strategyId,
      initialBalance,
      this.state.pollIntervalMs
    );
    this.saveState();
    return this.getState();
  }

  async start(options?: {
    symbol?: string;
    timeframe?: string;
    strategyId?: StrategyId;
    pollIntervalMs?: number;
    settings?: Partial<StrategySettings>;
  }): Promise<PaperWorkerState> {
    if (options) {
      this.configure(options);
    }
    if (this.state.running) {
      return this.getState();
    }

    this.state.running = true;
    this.appendLog(
      'INFO',
      `Worker STARTED on ${this.state.symbol} (${this.state.timeframe}) every ${(this.state.pollIntervalMs / 1000).toFixed(0)}s`
    );
    this.saveState();

    await this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.state.pollIntervalMs);

    return this.getState();
  }

  stop(): PaperWorkerState {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.state.running) {
      this.state.running = false;
      this.appendLog('WARN', 'Worker STOPPED by user.');
      this.saveState();
    }
    return this.getState();
  }

  private openLongPosition(price: number, atr: number, stopLoss?: number, takeProfit?: number, reason?: string): void {
    if (this.state.circuitBreakerTriggered) {
      this.appendLog('WARN', `Circuit Breaker active: blocked BUY @ $${price.toFixed(2)}. Reset or raise Max Daily Loss.`);
      return;
    }
    const sl = stopLoss ?? price - 2.0 * atr;
    const tp = takeProfit ?? price + (this.state.settings?.riskRewardRatio || 2.5) * 2.0 * atr;
    const riskPct = (this.state.settings?.riskPerTradePercent || 2.0) / 100;
    const riskCapital = this.state.cashBalance * riskPct;
    const stopDistance = Math.abs(price - sl);
    const rawCost = stopDistance > 0 ? (riskCapital / stopDistance) * price : this.state.cashBalance * 0.5;
    const allocatedCapital = Math.min(this.state.cashBalance * 0.95, Math.max(this.state.cashBalance * 0.25, rawCost));
    const amount = allocatedCapital / price;

    if (amount > 0 && this.state.cashBalance >= allocatedCapital) {
      this.state.cashBalance -= allocatedCapital;
      this.state.position = {
        symbol: this.state.symbol,
        entryPrice: price,
        amount,
        entryTime: Date.now(),
        stopLoss: sl,
        takeProfit: tp,
        highestSinceEntry: price
      };
      this.appendLog(
        'TRADE',
        `OPENED LONG ${this.state.symbol} (${amount.toFixed(4)}) @ $${price.toFixed(2)} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)} — ${reason || 'Signal'}`
      );
    }
  }

  private closePosition(exitPrice: number, exitReason: string): void {
    const pos = this.state.position;
    if (!pos) return;

    const pnl = (exitPrice - pos.entryPrice) * pos.amount;
    const pnlPercent = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
    this.state.cashBalance += pos.amount * pos.entryPrice + pnl;

    this.state.trades.unshift({
      entryTime: pos.entryTime,
      exitTime: Date.now(),
      entryPrice: pos.entryPrice,
      exitPrice,
      amount: pos.amount,
      pnl,
      pnlPercent,
      type: 'LONG',
      exitReason
    });

    this.state.position = null;
    this.appendLog(
      'TRADE',
      `CLOSED LONG ${pos.symbol} @ $${exitPrice.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) — ${exitReason}`
    );
  }

  private recomputeEquity(markPrice: number): void {
    if (this.state.position) {
      const posValue = this.state.position.amount * markPrice;
      const costBasis = this.state.position.amount * this.state.position.entryPrice;
      this.state.unrealizedPnl = posValue - costBasis;
      this.state.unrealizedPnlPercent = ((markPrice - this.state.position.entryPrice) / this.state.position.entryPrice) * 100;
      this.state.equity = this.state.cashBalance + posValue;
    } else {
      this.state.unrealizedPnl = 0;
      this.state.unrealizedPnlPercent = 0;
      this.state.equity = this.state.cashBalance;
    }

    const totalTrades = this.state.trades.length;
    const wins = this.state.trades.filter(t => t.pnl > 0).length;
    this.state.realizedPnl = this.state.trades.reduce((sum, t) => sum + t.pnl, 0);
    this.state.winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    const drawdownFromInitial = ((this.state.initialBalance - this.state.equity) / this.state.initialBalance) * 100;
    if (drawdownFromInitial >= (this.state.maxDailyLossPercent || 5.0)) {
      this.state.circuitBreakerTriggered = true;
    }
  }

  async executeTradingViewSignal(payload: {
    symbol: string;
    action: 'BUY' | 'SELL' | 'CLOSE' | 'ANALYZE';
    timeframe?: string;
    source?: string;
  }): Promise<PaperWorkerState> {
    const normalizedSymbol = normalizeSymbolPair(payload.symbol);
    const timeframe = payload.timeframe || this.state.timeframe;
    const source = payload.source || 'TradingView';

    // Close existing position on a different symbol before switching if trading
    if (this.state.position && this.state.position.symbol !== normalizedSymbol && payload.action !== 'ANALYZE') {
      const oldTicker = await this.exchange.fetchTicker(this.state.position.symbol);
      const oldPrice = oldTicker.last ?? this.state.position.entryPrice;
      this.closePosition(oldPrice, `Switched symbol to ${normalizedSymbol}`);
    }

    this.state.symbol = normalizedSymbol;
    this.state.timeframe = timeframe;

    const candles = await this.exchange.fetchCandles(normalizedSymbol, timeframe, 260);
    const latest = candles[candles.length - 1];
    const atrValues = TechnicalIndicators.getATR(candles, 14);
    const currentAtr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : latest.close * 0.02;

    const strategy = createStrategy(this.state.strategyId);
    const quantSignal = strategy.analyze(candles);

    this.state.lastPrice = latest.close;
    this.state.lastSignal = quantSignal;
    this.state.lastTickAt = Date.now();

    const action = payload.action.toUpperCase() as 'BUY' | 'SELL' | 'CLOSE' | 'ANALYZE';

    if (action === 'BUY') {
      if (this.state.position && this.state.position.symbol === normalizedSymbol) {
        this.appendLog('WARN', `${source} BUY ignored: already holding LONG ${normalizedSymbol}.`);
      } else {
        this.openLongPosition(
          latest.close,
          currentAtr,
          quantSignal.stopLoss,
          quantSignal.takeProfit,
          `${source} Alert (Quant: ${quantSignal.reason})`
        );
      }
    } else if (action === 'SELL' || action === 'CLOSE') {
      if (this.state.position) {
        this.closePosition(latest.close, `${source} ${action} Alert`);
      } else {
        this.appendLog('SIGNAL', `${source} ${action} received at $${latest.close.toFixed(2)} (No open position).`);
      }
    } else {
      // ANALYZE mode: execute if quant strategy explicitly triggers BUY/SELL
      this.appendLog('SIGNAL', `${source} Analysis on ${normalizedSymbol} @ $${latest.close.toFixed(2)}: ${quantSignal.type} — ${quantSignal.reason}`);
      if (!this.state.position && quantSignal.type === 'BUY') {
        this.openLongPosition(latest.close, currentAtr, quantSignal.stopLoss, quantSignal.takeProfit, quantSignal.reason);
      } else if (this.state.position && quantSignal.type === 'SELL') {
        this.closePosition(latest.close, quantSignal.reason);
      }
    }

    this.recomputeEquity(latest.close);
    this.saveState();
    return this.getState();
  }

  async tick(): Promise<PaperWorkerState> {
    if (this.isTicking) return this.getState();
    this.isTicking = true;

    try {
      const candles = await this.exchange.fetchCandles(this.state.symbol, this.state.timeframe, 260);
      if (candles.length < 30) {
        this.appendLog('WARN', `Insufficient candle data returned for ${this.state.symbol}`);
        return this.getState();
      }

      const latest = candles[candles.length - 1];
      const atrValues = TechnicalIndicators.getATR(candles, 14);
      const currentAtr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : latest.close * 0.02;

      const strategy = createStrategy(this.state.strategyId, this.state.settings);
      const signal = strategy.analyze(candles);

      this.state.lastPrice = latest.close;
      this.state.lastSignal = signal;
      this.state.lastTickAt = Date.now();

      if (this.state.position && this.state.position.symbol === this.state.symbol) {
        const pos = this.state.position;
        if (!pos.highestSinceEntry || latest.high > pos.highestSinceEntry) {
          pos.highestSinceEntry = latest.high;
        }

        const trailingStop = pos.highestSinceEntry - 1.8 * currentAtr;
        if (pos.stopLoss === undefined || trailingStop > pos.stopLoss) {
          pos.stopLoss = trailingStop;
        }

        if (pos.stopLoss && latest.close <= pos.stopLoss) {
          this.closePosition(latest.close, `Trailing Stop Hit ($${pos.stopLoss.toFixed(2)})`);
        } else if (pos.takeProfit && latest.close >= pos.takeProfit) {
          this.closePosition(latest.close, `Take Profit Hit ($${pos.takeProfit.toFixed(2)})`);
        } else if (signal.type === 'SELL') {
          this.closePosition(latest.close, signal.reason);
        }
      }

      if (!this.state.position && signal.type === 'BUY') {
        this.openLongPosition(signal.price, currentAtr, signal.stopLoss, signal.takeProfit, signal.reason);
      } else if (signal.type === 'HOLD') {
        this.appendLog('SIGNAL', `Tick $${latest.close.toFixed(2)}: HOLD — ${signal.reason}`);
      } else if (signal.type === 'SELL' && !this.state.position) {
        this.appendLog('SIGNAL', `Tick $${latest.close.toFixed(2)}: SELL (Flat/No position) — ${signal.reason}`);
      }

      this.recomputeEquity(latest.close);
      this.saveState();
    } catch (error: any) {
      this.appendLog('ERROR', `Tick failed: ${error?.message || String(error)}`);
    } finally {
      this.isTicking = false;
    }

    return this.getState();
  }
}
