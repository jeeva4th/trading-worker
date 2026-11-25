import fs from 'fs';
import path from 'path';
import { ExchangeConnector } from '../connectors/exchange';
import { TechnicalIndicators } from '../indicators';
import { createStrategy } from '../strategies';
import { Position, StrategyId, TradeRecord, TradeSignal } from '../types';

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
  initialBalance: number;
  cashBalance: number;
  lastPrice: number;
  equity: number;
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

    const defaultState = this.createDefaultState('BTC/USDT', '1h', 'adaptive', 10000, 15000);
    this.state = this.loadState() || defaultState;
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
      initialBalance,
      cashBalance: initialBalance,
      lastPrice: 0,
      equity: initialBalance,
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
  }): PaperWorkerState {
    if (options.symbol) this.state.symbol = options.symbol;
    if (options.timeframe) this.state.timeframe = options.timeframe;
    if (options.strategyId) {
      this.state.strategyId = options.strategyId;
      this.state.strategyName = createStrategy(options.strategyId).name;
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

    // Run immediate evaluation tick
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

      const strategy = createStrategy(this.state.strategyId);
      const signal = strategy.analyze(candles);

      this.state.lastPrice = latest.close;
      this.state.lastSignal = signal;
      this.state.lastTickAt = Date.now();

      // 1. Evaluate active position (trailing stop, TP, or strategy SELL)
      if (this.state.position && this.state.position.symbol === this.state.symbol) {
        const pos = this.state.position;
        if (!pos.highestSinceEntry || latest.high > pos.highestSinceEntry) {
          pos.highestSinceEntry = latest.high;
        }

        // Chandelier trailing stop
        const trailingStop = pos.highestSinceEntry - 1.8 * currentAtr;
        if (pos.stopLoss === undefined || trailingStop > pos.stopLoss) {
          pos.stopLoss = trailingStop;
        }

        let shouldExit = false;
        let exitReason = '';

        if (pos.stopLoss && latest.close <= pos.stopLoss) {
          shouldExit = true;
          exitReason = `Trailing Stop Hit ($${pos.stopLoss.toFixed(2)})`;
        } else if (pos.takeProfit && latest.close >= pos.takeProfit) {
          shouldExit = true;
          exitReason = `Take Profit Hit ($${pos.takeProfit.toFixed(2)})`;
        } else if (signal.type === 'SELL') {
          shouldExit = true;
          exitReason = signal.reason;
        }

        if (shouldExit) {
          const exitPrice = latest.close;
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
            `CLOSED LONG ${this.state.symbol} @ $${exitPrice.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) — ${exitReason}`
          );
        }
      }

      // 2. Evaluate new BUY entry
      if (!this.state.position && signal.type === 'BUY') {
        const riskCapital = this.state.cashBalance * 0.02;
        const stopDistance = signal.stopLoss ? Math.abs(signal.price - signal.stopLoss) : currentAtr * 2;
        const rawCost = stopDistance > 0 ? (riskCapital / stopDistance) * signal.price : this.state.cashBalance * 0.5;
        const allocatedCapital = Math.min(this.state.cashBalance * 0.95, Math.max(this.state.cashBalance * 0.25, rawCost));
        const amount = allocatedCapital / signal.price;

        if (amount > 0 && this.state.cashBalance >= allocatedCapital) {
          this.state.cashBalance -= allocatedCapital;
          this.state.position = {
            symbol: this.state.symbol,
            entryPrice: signal.price,
            amount,
            entryTime: Date.now(),
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            highestSinceEntry: signal.price
          };
          this.appendLog(
            'TRADE',
            `OPENED LONG ${this.state.symbol} (${amount.toFixed(4)}) @ $${signal.price.toFixed(2)} | SL: $${(signal.stopLoss || 0).toFixed(2)} — ${signal.reason}`
          );
        }
      } else if (signal.type === 'HOLD') {
        this.appendLog('SIGNAL', `Tick $${latest.close.toFixed(2)}: HOLD — ${signal.reason}`);
      } else if (signal.type === 'SELL' && !this.state.position) {
        this.appendLog('SIGNAL', `Tick $${latest.close.toFixed(2)}: SELL (Flat/No position) — ${signal.reason}`);
      }

      // 3. Recompute Equity & Unrealized PnL
      if (this.state.position) {
        const posValue = this.state.position.amount * latest.close;
        const costBasis = this.state.position.amount * this.state.position.entryPrice;
        this.state.unrealizedPnl = posValue - costBasis;
        this.state.unrealizedPnlPercent = ((latest.close - this.state.position.entryPrice) / this.state.position.entryPrice) * 100;
        this.state.equity = this.state.cashBalance + posValue;
      } else {
        this.state.unrealizedPnl = 0;
        this.state.unrealizedPnlPercent = 0;
        this.state.equity = this.state.cashBalance;
      }

      this.saveState();
    } catch (error: any) {
      this.appendLog('ERROR', `Tick failed: ${error?.message || String(error)}`);
    } finally {
      this.isTicking = false;
    }

    return this.getState();
  }
}
