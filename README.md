# trading-worker

A modular algorithmic trading worker and TradingView web application powered by CCXT, quantitative regime-filtering strategies, and TradingView charting.

## Features

- **Quantitative Strategy Engines**:
  - `Adaptive Regime (ADX + 200 EMA + ATR)`: Filters out choppy sideways markets and adapts between trend pullbacks and mean reversion.
  - `EMA Trend-Following + RSI Momentum`: Golden/Death cross strategy with RSI filter and ATR stops.
  - `Bollinger Bands + RSI Mean Reversion`: Oversold/overbought band bounces.
- **Chandelier Trailing Stops & Volatility Sizing**: Locks in profits during trend runs and sizes positions dynamically via ATR.
- **Automated Paper Trading Worker**: Runs continuous live evaluations with persistent state (`data/paper_state.json`).
- **TradingView Web Terminal**:
  - **Strategy Overlay View**: Powered by TradingView Lightweight Charts with live candlesticks, EMA 9/21/200 lines, Buy/Sell entry markers, Stop-Loss/Take-Profit lines, and Backtest Equity Curve.
  - **TradingView Pro Widget**: Official embedded TradingView interactive chart synced to the selected pair & timeframe.

## Quick Start

```bash
# Install dependencies
npm install

# Launch the TradingView Web Application + Paper Worker UI (http://localhost:3000)
npm run web

# Run CLI Backtest across all strategies
npm run backtest BTC/USDT 1h

# Start Paper Trading Worker in CLI mode
npm run paper BTC/USDT 1h adaptive
```
