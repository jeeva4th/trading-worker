export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalType = 'BUY' | 'SELL' | 'HOLD';

export interface TradeSignal {
  type: SignalType;
  price: number;
  timestamp: number;
  reason: string;
  stopLoss?: number;
  takeProfit?: number;
}

export interface Position {
  symbol: string;
  entryPrice: number;
  amount: number;
  entryTime: number;
  stopLoss?: number;
  takeProfit?: number;
  highestSinceEntry?: number;
}

export interface TradeRecord {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  pnlPercent: number;
  type: 'LONG';
  exitReason: string;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface BacktestResult {
  symbol: string;
  strategyName: string;
  initialBalance: number;
  finalBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  trades: TradeRecord[];
  equityCurve: EquityPoint[];
}

export interface Strategy {
  name: string;
  analyze(candles: Candle[]): TradeSignal;
}

export type StrategyId = 'adaptive' | 'trend' | 'reversion';
