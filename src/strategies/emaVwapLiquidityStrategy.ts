import { Candle, DEFAULT_STRATEGY_SETTINGS, SetupDiagnostics, Strategy, StrategySettings, TradeSignal } from '../types';
import { TechnicalIndicators } from '../indicators';

export class EmaVwapLiquidityStrategy implements Strategy {
  name = 'EMA VWAP Liquidity Reaction Model';
  private settings: StrategySettings;

  constructor(settings: Partial<StrategySettings> = {}) {
    this.settings = { ...DEFAULT_STRATEGY_SETTINGS, ...settings };
  }

  analyze(candles: Candle[]): TradeSignal {
    const current = candles[candles.length - 1];
    const lookback = Math.max(5, this.settings.liquidityLookback);

    if (candles.length < lookback + 5) {
      return {
        type: 'HOLD',
        price: current.close,
        timestamp: current.timestamp,
        reason: 'Warming up liquidity pools and EMAs'
      };
    }

    const fastEma = TechnicalIndicators.getEMA(candles, this.settings.fastEmaPeriod);
    const slowEma = TechnicalIndicators.getEMA(candles, this.settings.slowEmaPeriod);
    const macroEma = TechnicalIndicators.getEMA(candles, this.settings.macroEmaPeriod);
    const atrList = TechnicalIndicators.getATR(candles, 14);
    const rsiList = TechnicalIndicators.getRSI(candles, 14);
    const vwapList = TechnicalIndicators.getSessionVWAP(candles);

    if (fastEma.length < 2 || slowEma.length < 2 || vwapList.length < 2) {
      return {
        type: 'HOLD',
        price: current.close,
        timestamp: current.timestamp,
        reason: 'Insufficient indicator history'
      };
    }

    const currentFast = fastEma[fastEma.length - 1];
    const currentSlow = slowEma[slowEma.length - 1];
    const currentMacro = macroEma.length > 0 ? macroEma[macroEma.length - 1] : currentSlow;
    const currentVwap = vwapList[vwapList.length - 1];
    const currentAtr = atrList.length > 0 ? atrList[atrList.length - 1] : current.close * 0.01;
    const currentRsi = rsiList.length > 0 ? rsiList[rsiList.length - 1] : 50;

    // 1. Identify Sell-Side Liquidity (SSL = prior swing low) & Buy-Side Liquidity (BSL = prior swing high)
    // Exclude the current candle (and optionally the immediately preceding candle if testing multi-bar sweep)
    const poolWindow = candles.slice(-(lookback + 1), -1);
    const sellSideLiquidity = Math.min(...poolWindow.map(c => c.low));
    const buySideLiquidity = Math.max(...poolWindow.map(c => c.high));

    // 2. Candle anatomy & rejection wick
    const prev = candles[candles.length - 2];
    const range = Math.max(1e-8, current.high - current.low);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWickRatio = lowerWick / range;
    const upperWickRatio = upperWick / range;

    // 3. Liquidity Sweep Detection (current or previous candle swept pool and reclaimed/rejected)
    const sweptSslCurrent = current.low < sellSideLiquidity && current.close > sellSideLiquidity;
    const sweptSslPrev = prev.low < sellSideLiquidity && current.close > sellSideLiquidity && current.close > current.open;
    const bullishLiquiditySweep = sweptSslCurrent || sweptSslPrev;

    const sweptBslCurrent = current.high > buySideLiquidity && current.close < buySideLiquidity;
    const sweptBslPrev = prev.high > buySideLiquidity && current.close < buySideLiquidity && current.close < current.open;
    const bearishLiquiditySweep = sweptBslCurrent || sweptBslPrev;

    // 4. VWAP Reaction (reclaim above VWAP, bounce off VWAP/Lower Band, or inside reaction zone)
    const distanceToVwapAtr = Math.abs(current.close - currentVwap.vwap) / Math.max(1e-8, currentAtr);
    const vwapBullishReaction =
      (current.low <= currentVwap.vwap && current.close >= currentVwap.vwap) ||
      (current.low <= currentVwap.lower && current.close > currentVwap.lower) ||
      (current.close >= currentVwap.vwap && distanceToVwapAtr <= 1.25);

    const vwapBearishBreak = current.close < currentVwap.vwap && prev.close >= vwapList[vwapList.length - 2].vwap;

    // 5. EMA Alignment
    const emaBullishAligned = currentFast >= currentSlow || (current.close > currentFast && current.close >= currentMacro * 0.995);

    // 6. Rejection Wick Confirmation
    const bullishWickConfirmed = lowerWickRatio >= this.settings.minWickRatio || (current.close > current.open && current.close > prev.high);
    const bearishWickConfirmed = upperWickRatio >= this.settings.minWickRatio;

    // Compute Setup Confluence Score (0-100)
    let score = 0;
    if (emaBullishAligned) score += 25;
    if (vwapBullishReaction) score += 25;
    if (bullishLiquiditySweep) score += 30;
    if (bullishWickConfirmed) score += 20;

    // Suggested Stop Loss & Target
    const sweepLow = Math.min(current.low, prev.low);
    const suggestedStopLoss = sweepLow - 0.5 * currentAtr;
    const riskDistance = Math.max(currentAtr * 0.5, current.close - suggestedStopLoss);
    const suggestedTakeProfit = Math.max(
      current.close + riskDistance * this.settings.riskRewardRatio,
      buySideLiquidity
    );

    const diagnostics: SetupDiagnostics = {
      setupName: this.name,
      score,
      vwap: Number(currentVwap.vwap.toFixed(4)),
      vwapUpper: Number(currentVwap.upper.toFixed(4)),
      vwapLower: Number(currentVwap.lower.toFixed(4)),
      sellSideLiquidity: Number(sellSideLiquidity.toFixed(4)),
      buySideLiquidity: Number(buySideLiquidity.toFixed(4)),
      sweepType: bullishLiquiditySweep ? 'BULLISH_SWEEP' : bearishLiquiditySweep ? 'BEARISH_SWEEP' : 'NONE',
      emaAligned: emaBullishAligned,
      vwapReaction: vwapBullishReaction,
      liquiditySwept: bullishLiquiditySweep,
      wickConfirmed: bullishWickConfirmed,
      suggestedEntry: Number(current.close.toFixed(4)),
      suggestedStopLoss: Number(suggestedStopLoss.toFixed(4)),
      suggestedTakeProfit: Number(suggestedTakeProfit.toFixed(4))
    };

    // ENTRY TRIGGER: Liquidity Sweep + VWAP Reaction (or high confluence >= 75%) & RSI not exhausted
    if (
      (bullishLiquiditySweep && (vwapBullishReaction || emaBullishAligned) && currentRsi < 72) ||
      (score >= 80 && currentRsi < 68)
    ) {
      return {
        type: 'BUY',
        price: current.close,
        timestamp: current.timestamp,
        reason: `SSL Sweep @ $${sellSideLiquidity.toFixed(2)} + VWAP Reaction ($${currentVwap.vwap.toFixed(2)}) | Confluence ${score}%`,
        stopLoss: suggestedStopLoss,
        takeProfit: suggestedTakeProfit,
        diagnostics
      };
    }

    // EXIT TRIGGER: Buy-side liquidity sweep rejection OR VWAP breakdown + bearish EMA
    if (
      (bearishLiquiditySweep && bearishWickConfirmed) ||
      (vwapBearishBreak && currentFast < currentSlow && currentRsi < 48)
    ) {
      return {
        type: 'SELL',
        price: current.close,
        timestamp: current.timestamp,
        reason: bearishLiquiditySweep
          ? `BSL Sweep Rejection @ $${buySideLiquidity.toFixed(2)}`
          : `Lost VWAP ($${currentVwap.vwap.toFixed(2)}) & Bearish EMA Cross`,
        diagnostics
      };
    }

    return {
      type: 'HOLD',
      price: current.close,
      timestamp: current.timestamp,
      reason: `Confluence ${score}% | SSL: $${sellSideLiquidity.toFixed(2)} | VWAP: $${currentVwap.vwap.toFixed(2)} | BSL: $${buySideLiquidity.toFixed(2)}`,
      diagnostics
    };
  }
}
