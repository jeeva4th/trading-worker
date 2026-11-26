export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalType = 'BUY' | 'SELL' | 'HOLD';

export interface StrategySettings {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  macroEmaPeriod: number;
  liquidityLookback: number;
  minWickRatio: number;
  riskPerTradePercent: number;
  riskRewardRatio: number;
  useTrailingStop: boolean;
  initialBalance: number;
}

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  fastEmaPeriod: 9,
  slowEmaPeriod: 21,
  macroEmaPeriod: 200,
  liquidityLookback: 20,
  minWickRatio: 0.35,
  riskPerTradePercent: 2.0,
  riskRewardRatio: 2.5,
  useTrailingStop: true,
  initialBalance: 10000
};

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  minScore: number;
  cooldownMinutes: number;
}

export interface SetupDiagnostics {
  setupName: string;
  score: number;
  entryQuality: 'A+ ENTRY' | 'HIGH' | 'WATCH' | 'WAIT';
  isGreatEntry: boolean;
  structureState: 'BULLISH_BOS' | 'SWEEP_RECLAIM' | 'ACCUMULATION' | 'BEARISH_BOS' | 'RANGING';
  vwap: number;
  vwapUpper: number;
  vwapLower: number;
  sellSideLiquidity: number;
  buySideLiquidity: number;
  sweepType: 'NONE' | 'BULLISH_SWEEP' | 'BEARISH_SWEEP';
  emaAligned: boolean;
  vwapReaction: boolean;
  liquiditySwept: boolean;
  wickConfirmed: boolean;
  suggestedEntry: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
}

export interface TradeSignal {
  type: SignalType;
  price: number;
  timestamp: number;
  reason: string;
  stopLoss?: number;
  takeProfit?: number;
  diagnostics?: SetupDiagnostics;
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
  drawdownPercent?: number;
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

export type StrategyId = 'ema_vwap_liquidity' | 'adaptive' | 'trend' | 'reversion';
