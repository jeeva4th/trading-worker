# AGENTS.md

## Repository Overview
`trading-worker` is an automated trading and worker execution service.

## Architecture & Roles
- **Thinker (AGY)**: Analyzes market strategy, risk rules, and writes task specs.
- **Builder (Freebuff)**: Writes code, executes trading connectors, tests indicators.

## Development Commands
- Install: `npm install`
- Test: `npm test`
- Build: `npm run build`
