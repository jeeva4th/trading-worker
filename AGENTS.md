# AGENTS.md

## Repository Overview
`trading-worker` (**AetherQuant**) is an automated trading bot and live TradingView quantitative dashboard powered by CCXT, Session VWAP + Liquidity Reaction models, and real-time SSE streaming.

## Architecture & Roles
- **Thinker (AGY)**: Analyzes market regimes, liquidity pools, risk rules, and task specs.
- **Builder (Freebuff)**: Implements strategy code, exchange connectors, indicators, and dashboard UI.

## Installed Project Skills (`.agents/skills/`)
- `ml4t-cost-model` — Transaction costs, slippage, and market impact modeling (`ml4t/skills`)
- `ml4t-position-sizing` — Volatility targeting and risk-budget sizing (`ml4t/skills`)
- `ml4t-kill-switch` — Automated risk limits and circuit breakers (`ml4t/skills`)
- `ml4t-walk-forward-cv` — Temporal walk-forward validation (`ml4t/skills`)
- `systematic-debugging` — Root-cause debugging workflow (`obra/superpowers`)
- `verification-before-completion` — Mandatory verification before claiming completion (`obra/superpowers`)
- `frontend-design` — Modern frontend UI craftsmanship (`anthropics/skills`)

## Development Commands
- Install: `npm install`
- Build: `npm run build`
- Live Dashboard: `npm run web` (`http://localhost:5555`)
- Backtest: `npm run backtest XAU/USD 1h`
- Analyze URL/Ticker: `npm run analyze "OANDA:XAUUSD" 1h`
- Test: `npm test`
