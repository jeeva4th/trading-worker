const state = {
  symbol: 'BTC/USDT',
  timeframe: '1h',
  strategy: 'adaptive',
  activeTab: 'strategy',
  tvWidgetInitializedFor: null
};

let mainChart = null;
let candleSeries = null;
let volumeSeries = null;
let ema9Series = null;
let ema21Series = null;
let ema200Series = null;
let equityChart = null;
let equitySeries = null;
let lastPriceLines = [];

function initCharts() {
  const chartEl = document.getElementById('tv-lightweight-chart');
  mainChart = LightweightCharts.createChart(chartEl, {
    layout: {
      background: { type: 'solid', color: '#131722' },
      textColor: '#d1d4dc'
    },
    grid: {
      vertLines: { color: '#1e222d' },
      horzLines: { color: '#1e222d' }
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#262c3d' },
    timeScale: {
      borderColor: '#262c3d',
      timeVisible: true,
      secondsVisible: false
    }
  });

  candleSeries = mainChart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });

  volumeSeries = mainChart.addHistogramSeries({
    color: '#26a69a',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.82, bottom: 0 }
  });

  ema9Series = mainChart.addLineSeries({ color: '#22d3ee', lineWidth: 1.5, priceLineVisible: false });
  ema21Series = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, priceLineVisible: false });
  ema200Series = mainChart.addLineSeries({ color: '#a855f7', lineWidth: 2, priceLineVisible: false });

  const eqEl = document.getElementById('equity-chart');
  equityChart = LightweightCharts.createChart(eqEl, {
    layout: {
      background: { type: 'solid', color: '#131722' },
      textColor: '#d1d4dc'
    },
    grid: {
      vertLines: { color: '#1e222d' },
      horzLines: { color: '#1e222d' }
    },
    rightPriceScale: { borderColor: '#262c3d' },
    timeScale: { borderColor: '#262c3d', timeVisible: true }
  });

  equitySeries = equityChart.addAreaSeries({
    topColor: 'rgba(41, 98, 255, 0.35)',
    bottomColor: 'rgba(41, 98, 255, 0.02)',
    lineColor: '#2962ff',
    lineWidth: 2
  });

  window.addEventListener('resize', () => {
    if (mainChart) mainChart.applyOptions({ width: chartEl.clientWidth });
    if (equityChart) equityChart.applyOptions({ width: eqEl.clientWidth });
  });
}

function clearPriceLines() {
  for (const line of lastPriceLines) {
    candleSeries.removePriceLine(line);
  }
  lastPriceLines = [];
}

function toTvSymbol(pair) {
  return 'BINANCE:' + pair.replace('/', '');
}

function toTvInterval(tf) {
  const map = { '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };
  return map[tf] || '60';
}

function renderTradingViewProWidget() {
  const key = `${state.symbol}_${state.timeframe}`;
  if (state.tvWidgetInitializedFor === key) return;
  const container = document.getElementById('tradingview_pro_widget');
  container.innerHTML = '';

  if (typeof TradingView === 'undefined') {
    container.innerHTML = '<div style="padding:20px;color:#787b86;">TradingView widget script blocked or offline. Use Strategy Overlay tab.</div>';
    return;
  }

  new TradingView.widget({
    autosize: true,
    symbol: toTvSymbol(state.symbol),
    interval: toTvInterval(state.timeframe),
    timezone: 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'en',
    enable_publishing: false,
    allow_symbol_change: true,
    studies: ['STD;EMA', 'STD;RSI'],
    container_id: 'tradingview_pro_widget'
  });

  state.tvWidgetInitializedFor = key;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadMarket() {
  const statusEl = document.getElementById('chart-status');
  statusEl.textContent = `Fetching ${state.symbol} (${state.timeframe})...`;

  try {
    const data = await fetchJson(
      `/api/market?symbol=${encodeURIComponent(state.symbol)}&timeframe=${encodeURIComponent(state.timeframe)}&strategy=${encodeURIComponent(state.strategy)}&limit=350`
    );

    candleSeries.setData(data.candles);
    volumeSeries.setData(
      data.candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38, 166, 154, 0.35)' : 'rgba(239, 83, 80, 0.35)'
      }))
    );

    ema9Series.setData(data.indicators.ema9);
    ema21Series.setData(data.indicators.ema21);
    ema200Series.setData(data.indicators.ema200);

    // Update telemetry strip
    document.getElementById('metric-symbol').textContent = data.symbol;
    const priceEl = document.getElementById('metric-price');
    priceEl.textContent = `$${Number(data.ticker.last).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

    const change = Number(data.ticker.changePercent || 0);
    const changeEl = document.getElementById('metric-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% (24h)`;
    changeEl.className = `metric-sub ${change >= 0 ? 'pos-text-green' : 'pos-text-red'}`;

    const regimeEl = document.getElementById('metric-regime');
    regimeEl.textContent = data.metrics.regime;
    regimeEl.className = `regime-badge ${data.metrics.regimeBadge}`;
    document.getElementById('metric-adx').textContent = `ADX: ${data.metrics.adx} | 200 EMA: ${data.metrics.ema200 ?? '—'}`;

    document.getElementById('metric-rsi').textContent = `RSI ${data.metrics.rsi}`;
    document.getElementById('metric-atr').textContent = `ATR: $${data.metrics.atr}`;

    const sigEl = document.getElementById('metric-signal');
    sigEl.textContent = data.signal.type;
    sigEl.className = `signal-pill ${data.signal.type.toLowerCase()}`;
    document.getElementById('metric-signal-reason').textContent = data.signal.reason;

    clearPriceLines();
    if (data.signal.stopLoss) {
      lastPriceLines.push(
        candleSeries.createPriceLine({
          price: data.signal.stopLoss,
          color: '#ef5350',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          title: 'SL'
        })
      );
    }
    if (data.signal.takeProfit) {
      lastPriceLines.push(
        candleSeries.createPriceLine({
          price: data.signal.takeProfit,
          color: '#26a69a',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          title: 'TP'
        })
      );
    }

    mainChart.timeScale().fitContent();
    statusEl.textContent = `Live synced (${data.candles.length} candles)`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

async function runBacktest() {
  const btn = document.getElementById('btn-run-backtest');
  btn.disabled = true;
  btn.textContent = 'Running...';

  try {
    const res = await fetchJson('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategy: state.strategy,
        initialBalance: 10000,
        limit: 500
      })
    });

    // Plot Buy / Sell markers on TradingView candles
    const markers = [];
    for (const t of res.trades) {
      markers.push({
        time: t.entryTimeSec,
        position: 'belowBar',
        color: '#26a69a',
        shape: 'arrowUp',
        text: `BUY @${t.entryPrice.toFixed(0)}`
      });
      markers.push({
        time: t.exitTimeSec,
        position: 'aboveBar',
        color: t.pnl >= 0 ? '#22d3ee' : '#ef5350',
        shape: 'arrowDown',
        text: `${t.pnl >= 0 ? '+' : ''}${t.pnlPercent.toFixed(1)}%`
      });
    }
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);

    // Plot Equity Curve
    equitySeries.setData(res.equityCurve);
    equityChart.timeScale().fitContent();
    document.getElementById('equity-summary').textContent =
      `Final: $${res.finalBalance.toFixed(2)} (${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%)`;

    // Update Sidebar Backtest Metrics
    const retEl = document.getElementById('bt-return');
    retEl.textContent = `${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%`;
    retEl.className = res.totalPnlPercent >= 0 ? 'pos-text-green' : 'pos-text-red';

    document.getElementById('bt-winrate').textContent = `${res.winRate.toFixed(1)}%`;
    document.getElementById('bt-pf').textContent = `${res.profitFactor}`;
    document.getElementById('bt-dd').textContent = `${res.maxDrawdownPercent.toFixed(2)}%`;
    document.getElementById('bt-trade-count').textContent = res.totalTrades;

    const tradesList = document.getElementById('bt-trades');
    if (res.trades.length === 0) {
      tradesList.innerHTML = '<div class="pos-empty">No trades triggered in this window (Capital preserved).</div>';
    } else {
      tradesList.innerHTML = res.trades
        .slice()
        .reverse()
        .map(t => `
          <div class="trade-item ${t.pnl >= 0 ? 'win' : 'loss'}">
            <div class="trade-row">
              <strong>LONG $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)}</strong>
              <strong class="${t.pnl >= 0 ? 'pos-text-green' : 'pos-text-red'}">
                ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%)
              </strong>
            </div>
            <div class="metric-sub">${t.exitReason}</div>
          </div>
        `)
        .join('');
    }
  } catch (err) {
    alert(`Backtest failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Backtest';
  }
}

function renderWorkerState(w) {
  const badge = document.getElementById('worker-badge');
  badge.textContent = w.running ? 'RUNNING' : 'STOPPED';
  badge.className = `worker-status-dot ${w.running ? 'running' : ''}`;

  document.getElementById('btn-worker-start').disabled = w.running;
  document.getElementById('btn-worker-stop').disabled = !w.running;

  document.getElementById('worker-cash').textContent = `$${w.cashBalance.toFixed(2)}`;
  document.getElementById('worker-equity').textContent = `$${w.equity.toFixed(2)}`;
  document.getElementById('metric-equity').textContent = `$${w.equity.toFixed(2)}`;

  const unrEl = document.getElementById('metric-unrealized');
  unrEl.textContent = `Unrealized: ${w.unrealizedPnl >= 0 ? '+' : ''}$${w.unrealizedPnl.toFixed(2)}`;
  unrEl.className = `metric-sub ${w.unrealizedPnl >= 0 ? 'pos-text-green' : 'pos-text-red'}`;

  const posBox = document.getElementById('position-box');
  if (w.position) {
    posBox.innerHTML = `
      <div class="trade-row">
        <strong>OPEN LONG ${w.position.symbol}</strong>
        <strong class="${w.unrealizedPnl >= 0 ? 'pos-text-green' : 'pos-text-red'}">
          ${w.unrealizedPnlPercent >= 0 ? '+' : ''}${w.unrealizedPnlPercent.toFixed(2)}%
        </strong>
      </div>
      <div class="metric-sub">
        Entry: $${w.position.entryPrice.toFixed(2)} | Size: ${w.position.amount.toFixed(4)}
      </div>
      <div class="metric-sub">
        Trailing SL: $${(w.position.stopLoss || 0).toFixed(2)} | TP: $${(w.position.takeProfit || 0).toFixed(2)}
      </div>
    `;
  } else {
    posBox.innerHTML = `<div class="pos-empty">No open position (${w.symbol} Flat / Cash Protected)</div>`;
  }

  const logsEl = document.getElementById('worker-logs');
  logsEl.innerHTML = (w.logs || [])
    .slice(0, 20)
    .map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `<div class="log-item ${log.level}"><strong>[${time}]</strong> ${log.message}</div>`;
    })
    .join('');
}

async function refreshWorkerStatus() {
  try {
    const w = await fetchJson('/api/worker/status');
    renderWorkerState(w);
  } catch {
    // Ignore polling hiccup
  }
}

function bindEvents() {
  document.getElementById('btn-tv-analyze').addEventListener('click', async () => {
    const inputEl = document.getElementById('tv-url-input');
    const urlOrSymbol = inputEl.value.trim();
    if (!urlOrSymbol) return;
    const btn = document.getElementById('btn-tv-analyze');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    try {
      const res = await fetchJson('/api/tv/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrSymbol, timeframe: state.timeframe, action: 'ANALYZE' })
      });
      state.symbol = res.parsed.symbol;
      if (res.timeframe) state.timeframe = res.timeframe;

      const selectEl = document.getElementById('symbol-select');
      if (![...selectEl.options].some(o => o.value === state.symbol)) {
        const opt = document.createElement('option');
        opt.value = state.symbol;
        opt.textContent = state.symbol;
        selectEl.appendChild(opt);
      }
      selectEl.value = state.symbol;

      renderWorkerState(res.workerState);
      await loadMarket();
      await runBacktest();
      if (state.activeTab === 'tv') renderTradingViewProWidget();
    } catch (err) {
      alert(`Analyze failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyze URL';
    }
  });

  document.getElementById('btn-sim-tv-buy').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'BUY', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
  });

  document.getElementById('btn-sim-tv-sell').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'SELL', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
  });

  document.getElementById('symbol-select').addEventListener('change', async e => {
    state.symbol = e.target.value;
    await loadMarket();
    await runBacktest();
    if (state.activeTab === 'tv') renderTradingViewProWidget();
  });

  document.getElementById('strategy-select').addEventListener('change', async e => {
    state.strategy = e.target.value;
    await loadMarket();
    await runBacktest();
  });

  document.querySelectorAll('#timeframe-pills .pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#timeframe-pills .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.timeframe = btn.dataset.tf;
      await loadMarket();
      await runBacktest();
      if (state.activeTab === 'tv') renderTradingViewProWidget();
    });
  });

  document.getElementById('tab-strategy-chart').addEventListener('click', () => {
    state.activeTab = 'strategy';
    document.getElementById('tab-strategy-chart').classList.add('active');
    document.getElementById('tab-tv-widget').classList.remove('active');
    document.getElementById('strategy-chart-panel').classList.remove('hidden');
    document.getElementById('tv-widget-panel').classList.add('hidden');
  });

  document.getElementById('tab-tv-widget').addEventListener('click', () => {
    state.activeTab = 'tv';
    document.getElementById('tab-tv-widget').classList.add('active');
    document.getElementById('tab-strategy-chart').classList.remove('active');
    document.getElementById('strategy-chart-panel').classList.add('hidden');
    document.getElementById('tv-widget-panel').classList.remove('hidden');
    renderTradingViewProWidget();
  });

  document.getElementById('btn-run-backtest').addEventListener('click', runBacktest);
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await loadMarket();
    await refreshWorkerStatus();
  });

  document.getElementById('btn-worker-start').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategyId: state.strategy,
        pollIntervalMs: 15000
      })
    });
    renderWorkerState(w);
  });

  document.getElementById('btn-worker-stop').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/stop', { method: 'POST' });
    renderWorkerState(w);
  });

  document.getElementById('btn-worker-tick').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/tick', { method: 'POST' });
    renderWorkerState(w);
  });

  document.getElementById('btn-worker-reset').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialBalance: 10000 })
    });
    renderWorkerState(w);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initCharts();
  bindEvents();
  await loadMarket();
  await runBacktest();
  await refreshWorkerStatus();
  setInterval(refreshWorkerStatus, 5000);
});
