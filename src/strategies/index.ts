import { Strategy, StrategyId } from '../types';
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

export function createStrategy(id: StrategyId = 'adaptive'): Strategy {
  switch (id) {
    case 'trend':
      return new TrendFollowingStrategy(9, 21, 14);
    case 'reversion':
      return new MeanReversionStrategy(20, 2, 14);
    case 'adaptive':
    default:
      return new AdaptiveRegimeStrategy(14, 200, 9, 21);
  }
}

export { AdaptiveRegimeStrategy, TrendFollowingStrategy, MeanReversionStrategy };
