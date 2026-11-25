const state = {
  symbol: 'XAU/USD',
  timeframe: '1h',
  strategy: 'ema_vwap_liquidity',
  activeTab: 'strategy',
  tvWidgetInitializedFor: null
};

let mainChart = null;
let candleSeries = null;
let volumeSeries = null;
let emaFastSeries = null;
let emaSlowSeries = null;
let emaMacroSeries = null;
let vwapSeries = null;
let vwapUpperSeries = null;
let vwapLowerSeries = null;

let oscillatorChart = null;
let rsiSeries = null;
let adxSeries = null;

let equityChart = null;
let equitySeries = null;
let drawdownSeries = null;

let dynamicPriceLines = [];

function getSettingsFromUI() {
  return {
    fastEmaPeriod: Number(document.getElementById('set-fast-ema').value || 9),
    slowEmaPeriod: Number(document.getElementById('set-slow-ema').value || 21),
    macroEmaPeriod: Number(document.getElementById('set-macro-ema').value || 200),
    liquidityLookback: Number(document.getElementById('set-lookback').value || 20),
    minWickRatio: Number(document.getElementById('set-wick').value || 0.35),
    riskPerTradePercent: Number(document.getElementById('set-risk').value || 2.0),
    riskRewardRatio: Number(document.getElementById('set-rr').value || 2.5),
    initialBalance: Number(document.getElementById('set-capital').value || 10000),
    useTrailingStop: document.getElementById('set-trailing').checked
  };
}

function resetSettingsUI() {
  document.getElementById('set-fast-ema').value = 9;
  document.getElementById('set-slow-ema').value = 21;
  document.getElementById('set-macro-ema').value = 200;
  document.getElementById('set-lookback').value = 20;
  document.getElementById('set-wick').value = 0.35;
  document.getElementById('set-risk').value = 2.0;
  document.getElementById('set-rr').value = 2.5;
  document.getElementById('set-capital').value = 10000;
  document.getElementById('set-trailing').checked = true;
}

function initCharts() {
  const chartOpts = {
    layout: { background: { type: 'solid', color: '#131722' }, textColor: '#d1d4dc' },
    grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
    rightPriceScale: { borderColor: '#262c3d' },
    timeScale: { borderColor: '#262c3d', timeVisible: true, secondsVisible: false }
  };

  // 1. Main Price + EMA + VWAP + Liquidity Chart
  const chartEl = document.getElementById('tv-lightweight-chart');
  mainChart = LightweightCharts.createChart(chartEl, {
    ...chartOpts,
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });

  candleSeries = mainChart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });

  volumeSeries = mainChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.84, bottom: 0 }
  });

  emaFastSeries = mainChart.addLineSeries({ color: '#22d3ee', lineWidth: 1.5, priceLineVisible: false });
  emaSlowSeries = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, priceLineVisible: false });
  emaMacroSeries = mainChart.addLineSeries({ color: '#a855f7', lineWidth: 2, priceLineVisible: false });

  vwapSeries = mainChart.addLineSeries({ color: '#fbbf24', lineWidth: 2, priceLineVisible: false });
  vwapUpperSeries = mainChart.addLineSeries({
    color: 'rgba(251, 191, 36, 0.4)',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted,
    priceLineVisible: false
  });
  vwapLowerSeries = mainChart.addLineSeries({
    color: 'rgba(251, 191, 36, 0.4)',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted,
    priceLineVisible: false
  });

  // 2. Oscillator Graph (RSI + ADX)
  const oscEl = document.getElementById('oscillator-chart');
  oscillatorChart = LightweightCharts.createChart(oscEl, chartOpts);
  rsiSeries = oscillatorChart.addLineSeries({ color: '#22d3ee', lineWidth: 1.8, title: 'RSI' });
  adxSeries = oscillatorChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, title: 'ADX' });
  rsiSeries.createPriceLine({ price: 70, color: 'rgba(239, 83, 80, 0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
  rsiSeries.createPriceLine({ price: 30, color: 'rgba(38, 166, 154, 0.4)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
  adxSeries.createPriceLine({ price: 22, color: 'rgba(245, 158, 11, 0.35)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });

  // 3. Equity Curve & Drawdown Graph
  const eqEl = document.getElementById('equity-chart');
  equityChart = LightweightCharts.createChart(eqEl, chartOpts);
  equitySeries = equityChart.addAreaSeries({
    topColor: 'rgba(41, 98, 255, 0.35)',
    bottomColor: 'rgba(41, 98, 255, 0.02)',
    lineColor: '#2962ff',
    lineWidth: 2
  });
  drawdownSeries = equityChart.addHistogramSeries({
    color: 'rgba(239, 83, 80, 0.45)',
    priceScaleId: 'left',
    priceFormat: { type: 'percent' }
  });
  equityChart.priceScale('left').applyOptions({
    visible: true,
    borderColor: '#262c3d',
    scaleMargins: { top: 0.7, bottom: 0 }
  });

  window.addEventListener('resize', () => {
    if (mainChart) mainChart.applyOptions({ width: chartEl.clientWidth });
    if (oscillatorChart) oscillatorChart.applyOptions({ width: oscEl.clientWidth });
    if (equityChart) equityChart.applyOptions({ width: eqEl.clientWidth });
  });
}

function clearDynamicPriceLines() {
  for (const line of dynamicPriceLines) {
    candleSeries.removePriceLine(line);
  }
  dynamicPriceLines = [];
}

function applyLayerVisibility() {
  const showEmas = document.getElementById('toggle-emas').checked;
  const showVwap = document.getElementById('toggle-vwap').checked;

  emaFastSeries.applyOptions({ visible: showEmas });
  emaSlowSeries.applyOptions({ visible: showEmas });
  emaMacroSeries.applyOptions({ visible: showEmas });
  vwapSeries.applyOptions({ visible: showVwap });
  vwapUpperSeries.applyOptions({ visible: showVwap });
  vwapLowerSeries.applyOptions({ visible: showVwap });
}

function toTvSymbol(pair) {
  if (pair === 'XAU/USD' || pair === 'XAUUSD') return 'OANDA:XAUUSD';
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
    container.innerHTML = '<div style="padding:20px;color:#787b86;">TradingView widget offline. Use All Graphs view.</div>';
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
    studies: ['STD;EMA', 'STD;VWAP', 'STD;RSI'],
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

function renderChecklist(id, pass) {
  const el = document.getElementById(id);
  el.className = `check-item ${pass ? 'pass' : 'fail'}`;
  el.querySelector('strong').textContent = pass ? '✓ PASS' : 'WAIT';
}

function renderSetupDiagnostics(diag) {
  if (!diag) return;
  document.getElementById('metric-score').textContent = `${diag.score}%`;
  document.getElementById('setup-score-badge').textContent = `${diag.score}%`;

  renderChecklist('chk-ema', diag.emaAligned);
  renderChecklist('chk-vwap', diag.vwapReaction);
  renderChecklist('chk-sweep', diag.liquiditySwept);
  renderChecklist('chk-wick', diag.wickConfirmed);

  document.getElementById('setup-ssl').textContent = `$${diag.sellSideLiquidity.toLocaleString()}`;
  document.getElementById('setup-vwap').textContent = `$${diag.vwap.toLocaleString()}`;
  document.getElementById('setup-bsl').textContent = `$${diag.buySideLiquidity.toLocaleString()}`;
  document.getElementById('setup-sl').textContent = `$${diag.suggestedStopLoss.toLocaleString()}`;
  document.getElementById('setup-tp').textContent = `$${diag.suggestedTakeProfit.toLocaleString()}`;
  document.getElementById('setup-sweep-type').textContent = diag.sweepType;
}

async function loadMarket() {
  const statusEl = document.getElementById('chart-status');
  statusEl.textContent = `Loading ${state.symbol} (${state.timeframe})...`;
  const s = getSettingsFromUI();

  try {
    const qs = new URLSearchParams({
      symbol: state.symbol,
      timeframe: state.timeframe,
      strategy: state.strategy,
      limit: '350',
      fastEma: String(s.fastEmaPeriod),
      slowEma: String(s.slowEmaPeriod),
      macroEma: String(s.macroEmaPeriod),
      lookback: String(s.liquidityLookback),
      minWick: String(s.minWickRatio),
      rr: String(s.riskRewardRatio)
    });

    const data = await fetchJson(`/api/market?${qs.toString()}`);

    candleSeries.setData(data.candles);
    volumeSeries.setData(
      data.candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38, 166, 154, 0.35)' : 'rgba(239, 83, 80, 0.35)'
      }))
    );

    emaFastSeries.setData(data.indicators.emaFast);
    emaSlowSeries.setData(data.indicators.emaSlow);
    emaMacroSeries.setData(data.indicators.emaMacro);
    vwapSeries.setData(data.indicators.vwap);
    vwapUpperSeries.setData(data.indicators.vwapUpper);
    vwapLowerSeries.setData(data.indicators.vwapLower);

    rsiSeries.setData(data.indicators.rsiSeries);
    adxSeries.setData(data.indicators.adxSeries);

    applyLayerVisibility();

    // Update Telemetry Strip
    document.getElementById('metric-symbol').textContent = data.symbol;
    document.getElementById('metric-price').textContent = `$${Number(data.ticker.last).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

    const change = Number(data.ticker.changePercent || 0);
    const changeEl = document.getElementById('metric-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% (24h)`;
    changeEl.className = `metric-sub ${change >= 0 ? 'pos-text-green' : 'pos-text-red'}`;

    const regimeEl = document.getElementById('metric-regime');
    regimeEl.textContent = data.metrics.regime;
    regimeEl.className = `regime-badge ${data.metrics.regimeBadge}`;
    document.getElementById('metric-adx').textContent = `ADX: ${data.metrics.adx} | RSI: ${data.metrics.rsi}`;

    document.getElementById('metric-vwap').textContent = `VWAP $${data.metrics.vwap.toLocaleString()}`;
    document.getElementById('metric-ema200').textContent = `200 EMA: $${data.metrics.ema200 ?? '—'} | ATR: $${data.metrics.atr}`;

    const sigEl = document.getElementById('metric-signal');
    sigEl.textContent = data.signal.type;
    sigEl.className = `signal-pill ${data.signal.type.toLowerCase()}`;
    document.getElementById('metric-signal-reason').textContent = data.signal.reason;

    if (data.diagnostics) {
      renderSetupDiagnostics(data.diagnostics);
    }

    // Draw Liquidity Pools & Setup SL/TP Price Lines
    clearDynamicPriceLines();
    const showLiquidity = document.getElementById('toggle-liquidity').checked;
    if (showLiquidity && data.diagnostics) {
      dynamicPriceLines.push(
        candleSeries.createPriceLine({
          price: data.diagnostics.buySideLiquidity,
          color: '#ec4899',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          title: 'BSL (High)'
        }),
        candleSeries.createPriceLine({
          price: data.diagnostics.sellSideLiquidity,
          color: '#22d3ee',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          title: 'SSL (Low)'
        })
      );
    }

    if (data.signal.stopLoss || data.diagnostics?.suggestedStopLoss) {
      dynamicPriceLines.push(
        candleSeries.createPriceLine({
          price: data.signal.stopLoss || data.diagnostics.suggestedStopLoss,
          color: '#ef5350',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          title: 'Setup SL'
        })
      );
    }
    if (data.signal.takeProfit || data.diagnostics?.suggestedTakeProfit) {
      dynamicPriceLines.push(
        candleSeries.createPriceLine({
          price: data.signal.takeProfit || data.diagnostics.suggestedTakeProfit,
          color: '#26a69a',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          title: 'Setup TP'
        })
      );
    }

    mainChart.timeScale().fitContent();
    oscillatorChart.timeScale().fitContent();
    statusEl.textContent = `Synced ${data.candles.length} candles`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

async function runBacktest() {
  const btn = document.getElementById('btn-run-backtest');
  btn.disabled = true;
  btn.textContent = 'Running...';
  const settings = getSettingsFromUI();

  try {
    const res = await fetchJson('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategy: state.strategy,
        limit: 500,
        settings
      })
    });

    const markers = [];
    for (const t of res.trades) {
      markers.push({
        time: t.entryTimeSec,
        position: 'belowBar',
        color: '#26a69a',
        shape: 'arrowUp',
        text: `BUY @${t.entryPrice.toFixed(1)}`
      });
      markers.push({
        time: t.exitTimeSec,
        position: 'aboveBar',
        color: t.pnl >= 0 ? '#fbbf24' : '#ef5350',
        shape: 'arrowDown',
        text: `${t.pnl >= 0 ? '+' : ''}${t.pnlPercent.toFixed(1)}%`
      });
    }
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);

    equitySeries.setData(res.equityCurve.map(p => ({ time: p.time, value: p.value })));
    drawdownSeries.setData(res.equityCurve.map(p => ({ time: p.time, value: p.drawdown })));
    equityChart.timeScale().fitContent();

    document.getElementById('equity-summary').textContent =
      `Final: $${res.finalBalance.toFixed(2)} (${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%)`;

    const retEl = document.getElementById('bt-return');
    retEl.textContent = `${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%`;
    retEl.className = res.totalPnlPercent >= 0 ? 'pos-text-green' : 'pos-text-red';

    document.getElementById('bt-winrate').textContent = `${res.winRate.toFixed(1)}%`;
    document.getElementById('bt-pf').textContent = `${res.profitFactor}`;
    document.getElementById('bt-dd').textContent = `${res.maxDrawdownPercent.toFixed(2)}%`;
    document.getElementById('bt-trade-count').textContent = res.totalTrades;
    document.getElementById('bt-trade-count-label').textContent = `${res.totalTrades} trades`;

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

async function scanSetups() {
  const tbody = document.getElementById('scanner-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="pos-empty">Scanning XAU/USD, BTC, ETH, SOL, BNB...</td></tr>';
  const s = getSettingsFromUI();

  try {
    const qs = new URLSearchParams({
      timeframe: state.timeframe,
      fastEma: String(s.fastEmaPeriod),
      slowEma: String(s.slowEmaPeriod),
      macroEma: String(s.macroEmaPeriod),
      lookback: String(s.liquidityLookback),
      minWick: String(s.minWickRatio)
    });

    const res = await fetchJson(`/api/setups/scan?${qs.toString()}`);
    tbody.innerHTML = res.setups
      .map(item => {
        const d = item.diagnostics;
        return `
          <tr>
            <td><strong>${item.symbol}</strong></td>
            <td>$${Number(item.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td><span class="score-pill">${d ? d.score : 0}%</span></td>
            <td>${d ? d.sweepType : 'NONE'}</td>
            <td>${d ? `$${d.sellSideLiquidity.toFixed(1)} / $${d.buySideLiquidity.toFixed(1)}` : '—'}</td>
            <td>${d ? `$${d.vwap.toFixed(1)}` : '—'}</td>
            <td><span class="signal-pill ${item.signal.toLowerCase()}">${item.signal}</span></td>
            <td><button class="btn btn-ghost btn-sm" onclick="selectScannedAsset('${item.symbol}')">Load</button></td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="pos-empty">Scanner error: ${err.message}</td></tr>`;
  }
}

window.selectScannedAsset = async function selectScannedAsset(symbol) {
  state.symbol = symbol;
  document.getElementById('symbol-select').value = symbol;
  await loadMarket();
  await runBacktest();
  if (state.activeTab === 'tv') renderTradingViewProWidget();
};

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
      <div class="metric-sub">Entry: $${w.position.entryPrice.toFixed(2)} | Size: ${w.position.amount.toFixed(4)}</div>
      <div class="metric-sub">SL: $${(w.position.stopLoss || 0).toFixed(2)} | TP: $${(w.position.takeProfit || 0).toFixed(2)}</div>
    `;
  } else {
    posBox.innerHTML = `<div class="pos-empty">No open position (${w.symbol} Flat)</div>`;
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
    // Ignore transient polling issue
  }
}

function bindEvents() {
  document.getElementById('toggle-emas').addEventListener('change', applyLayerVisibility);
  document.getElementById('toggle-vwap').addEventListener('change', applyLayerVisibility);
  document.getElementById('toggle-liquidity').addEventListener('change', loadMarket);

  document.getElementById('btn-apply-settings').addEventListener('click', async () => {
    const settings = getSettingsFromUI();
    await fetchJson('/api/worker/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategyId: state.strategy,
        settings
      })
    });
    await loadMarket();
    await runBacktest();
    await scanSetups();
  });

  document.getElementById('btn-reset-settings').addEventListener('click', async () => {
    resetSettingsUI();
    await loadMarket();
    await runBacktest();
  });

  document.getElementById('btn-scan-setups').addEventListener('click', scanSetups);

  document.getElementById('btn-take-setup').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'BUY', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
  });

  document.getElementById('btn-close-setup').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'SELL', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
  });

  document.getElementById('btn-tv-analyze').addEventListener('click', async () => {
    const urlOrSymbol = document.getElementById('tv-url-input').value.trim();
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
      await scanSetups();
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
    await scanSetups();
  });

  document.getElementById('btn-worker-start').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategyId: state.strategy,
        pollIntervalMs: 15000,
        settings: getSettingsFromUI()
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
    const settings = getSettingsFromUI();
    const w = await fetchJson('/api/worker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialBalance: settings.initialBalance })
    });
    renderWorkerState(w);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const urlSymbol = params.get('symbol');
  const urlTab = params.get('tab');
  if (urlSymbol) {
    state.symbol = urlSymbol;
    const selectEl = document.getElementById('symbol-select');
    if (![...selectEl.options].some(o => o.value === state.symbol)) {
      const opt = document.createElement('option');
      opt.value = state.symbol;
      opt.textContent = state.symbol;
      selectEl.appendChild(opt);
    }
    selectEl.value = state.symbol;
  }

  initCharts();
  bindEvents();
  await Promise.all([loadMarket(), runBacktest(), refreshWorkerStatus(), scanSetups()]);

  if (urlTab === 'tv') {
    document.getElementById('tab-tv-widget').click();
  }

  setInterval(refreshWorkerStatus, 5000);
});
