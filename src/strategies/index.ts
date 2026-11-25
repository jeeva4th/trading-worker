import { DEFAULT_STRATEGY_SETTINGS, Strategy, StrategyId, StrategySettings } from '../types';
import { EmaVwapLiquidityStrategy } from './emaVwapLiquidityStrategy';
import { AdaptiveRegimeStrategy } from './adaptiveRegimeStrategy';
import { TrendFollowingStrategy } from './trendFollowing';
import { MeanReversionStrategy } from './meanReversion';

export interface StrategyMeta {
  id: StrategyId;
  name: string;
  description: string;
}

export const STRATEGY_CATALOG: StrategyMeta[] = [
  {
    id: 'ema_vwap_liquidity',
    name: 'EMA VWAP Liquidity Reaction Model',
    description: 'Sweeps Sell-Side/Buy-Side liquidity, confirms VWAP institutional reaction, and aligns with EMA bias.'
  },
  {
    id: 'adaptive',
    name: 'Adaptive Regime (ADX + 200 EMA + ATR)',
    description: 'Classifies Trend vs Range vs Chop using ADX and 200 EMA; protects capital in chop.'
  },
  {
    id: 'trend',
    name: 'EMA Trend-Following + RSI Momentum',
    description: 'EMA 9/21 crossover filtered by RSI momentum and ATR stop/target.'
  },
  {
    id: 'reversion',
    name: 'Bollinger Bands + RSI Mean Reversion',
    description: 'Captures oversold bounces at lower Bollinger Band with RSI confirmation.'
  }
];

export function createStrategy(
  id: StrategyId = 'ema_vwap_liquidity',
  settings: Partial<StrategySettings> = {}
): Strategy {
  const merged = { ...DEFAULT_STRATEGY_SETTINGS, ...settings };
  switch (id) {
    case 'adaptive':
      return new AdaptiveRegimeStrategy(14, merged.macroEmaPeriod, merged.fastEmaPeriod, merged.slowEmaPeriod);
    case 'trend':
      return new TrendFollowingStrategy(merged.fastEmaPeriod, merged.slowEmaPeriod, 14);
    case 'reversion':
      return new MeanReversionStrategy(20, 2, 14);
    case 'ema_vwap_liquidity':
    default:
      return new EmaVwapLiquidityStrategy(merged);
  }
}

export { EmaVwapLiquidityStrategy, AdaptiveRegimeStrategy, TrendFollowingStrategy, MeanReversionStrategy };
