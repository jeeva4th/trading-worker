const state = {
  symbol: 'XAU/USD',
  timeframe: '1h',
  strategy: 'ema_vwap_liquidity',
  activeView: 'terminal',
  tvWidgetInitializedFor: null,
  streamEnabled: true,
  lastTickPrice: null,
  lastCandleTimeSec: null,
  tickSeq: 0
};

let liveStreamTimer = null;
let liveTickInFlight = false;

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

function showToast(message) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

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

function applyPreset(name) {
  const presets = {
    conservative: { fast: 12, slow: 26, macro: 200, lookback: 30, wick: 0.45, risk: 1.0, rr: 3.0, trailing: true },
    balanced: { fast: 9, slow: 21, macro: 200, lookback: 20, wick: 0.35, risk: 2.0, rr: 2.5, trailing: true },
    aggressive: { fast: 5, slow: 13, macro: 100, lookback: 12, wick: 0.25, risk: 3.0, rr: 2.0, trailing: true }
  };
  const p = presets[name] || presets.balanced;
  document.getElementById('set-fast-ema').value = p.fast;
  document.getElementById('set-slow-ema').value = p.slow;
  document.getElementById('set-macro-ema').value = p.macro;
  document.getElementById('set-lookback').value = p.lookback;
  document.getElementById('set-wick').value = p.wick;
  document.getElementById('set-risk').value = p.risk;
  document.getElementById('set-rr').value = p.rr;
  document.getElementById('set-trailing').checked = p.trailing;
}

function initCharts() {
  const chartOpts = {
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8b9bb4', fontFamily: 'Inter, sans-serif' },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false }
  };

  const chartEl = document.getElementById('tv-lightweight-chart');
  mainChart = LightweightCharts.createChart(chartEl, {
    ...chartOpts,
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });

  candleSeries = mainChart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#f43f5e',
    borderVisible: false,
    wickUpColor: '#10b981',
    wickDownColor: '#f43f5e'
  });

  volumeSeries = mainChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.85, bottom: 0 }
  });

  emaFastSeries = mainChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, priceLineVisible: false });
  emaSlowSeries = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, priceLineVisible: false });
  emaMacroSeries = mainChart.addLineSeries({ color: '#a855f7', lineWidth: 2, priceLineVisible: false });
  vwapSeries = mainChart.addLineSeries({ color: '#fbbf24', lineWidth: 2, priceLineVisible: false });
  vwapUpperSeries = mainChart.addLineSeries({ color: 'rgba(251,191,36,0.38)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, priceLineVisible: false });
  vwapLowerSeries = mainChart.addLineSeries({ color: 'rgba(251,191,36,0.38)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, priceLineVisible: false });

  const oscEl = document.getElementById('oscillator-chart');
  oscillatorChart = LightweightCharts.createChart(oscEl, chartOpts);
  rsiSeries = oscillatorChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.8 });
  adxSeries = oscillatorChart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5 });
  rsiSeries.createPriceLine({ price: 70, color: 'rgba(244,63,94,0.35)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
  rsiSeries.createPriceLine({ price: 30, color: 'rgba(16,185,129,0.35)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
  adxSeries.createPriceLine({ price: 22, color: 'rgba(245,158,11,0.35)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted });

  const eqEl = document.getElementById('equity-chart');
  equityChart = LightweightCharts.createChart(eqEl, chartOpts);
  equitySeries = equityChart.addAreaSeries({
    topColor: 'rgba(56, 189, 248, 0.35)',
    bottomColor: 'rgba(56, 189, 248, 0.02)',
    lineColor: '#38bdf8',
    lineWidth: 2
  });
  drawdownSeries = equityChart.addHistogramSeries({
    color: 'rgba(244, 63, 94, 0.45)',
    priceScaleId: 'left',
    priceFormat: { type: 'percent' }
  });
  equityChart.priceScale('left').applyOptions({
    visible: true,
    borderColor: 'rgba(255,255,255,0.08)',
    scaleMargins: { top: 0.72, bottom: 0 }
  });

  window.addEventListener('resize', resizeCharts);
}

function resizeCharts() {
  const chartEl = document.getElementById('tv-lightweight-chart');
  const oscEl = document.getElementById('oscillator-chart');
  const eqEl = document.getElementById('equity-chart');
  if (mainChart && chartEl.clientWidth > 0) mainChart.applyOptions({ width: chartEl.clientWidth });
  if (oscillatorChart && oscEl.clientWidth > 0) oscillatorChart.applyOptions({ width: oscEl.clientWidth });
  if (equityChart && eqEl.clientWidth > 0) equityChart.applyOptions({ width: eqEl.clientWidth });
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
    container.innerHTML = '<div class="empty-msg">TradingView script unavailable offline.</div>';
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
  el.className = `check-pill ${pass ? 'pass' : 'fail'}`;
  el.querySelector('strong').textContent = pass ? '✓ PASS' : 'WAIT';
}

function renderSetupDiagnostics(diag) {
  if (!diag) return;
  const score = Math.min(100, Math.max(0, diag.score || 0));
  document.getElementById('setup-score-badge').textContent = `${score}%`;

  const circumference = 113.1;
  const offset = circumference - (score / 100) * circumference;
  document.getElementById('setup-gauge-ring').style.strokeDashoffset = offset.toFixed(1);

  renderChecklist('chk-ema', diag.emaAligned);
  renderChecklist('chk-vwap', diag.vwapReaction);
  renderChecklist('chk-sweep', diag.liquiditySwept);
  renderChecklist('chk-wick', diag.wickConfirmed);

  document.getElementById('setup-ssl').textContent = `$${diag.sellSideLiquidity.toLocaleString()}`;
  document.getElementById('setup-vwap').textContent = `$${diag.vwap.toLocaleString()}`;
  document.getElementById('setup-bsl').textContent = `$${diag.buySideLiquidity.toLocaleString()}`;
  const entryEl = document.getElementById('setup-entry');
  if (entryEl) entryEl.textContent = `$${diag.suggestedEntry.toLocaleString()}`;
  document.getElementById('setup-sl').textContent = `$${diag.suggestedStopLoss.toLocaleString()}`;
  document.getElementById('setup-tp').textContent = `$${diag.suggestedTakeProfit.toLocaleString()}`;

  const banner = document.getElementById('great-entry-banner');
  const qBadge = document.getElementById('setup-quality-badge');
  const stState = document.getElementById('setup-structure-state');
  const levelsText = document.getElementById('great-entry-text');
  if (banner && qBadge && stState && levelsText) {
    const quality = diag.entryQuality || 'WAIT';
    qBadge.textContent = diag.isGreatEntry ? `⚡ ${quality}` : quality;
    qBadge.className = `quality-badge ${quality === 'A+ ENTRY' ? 'aplus' : quality === 'HIGH' ? 'high' : ''}`;
    stState.textContent = `${diag.structureState || 'RANGING'} · ${diag.sweepType}`;
    banner.classList.toggle('great', Boolean(diag.isGreatEntry));
    levelsText.textContent = diag.isGreatEntry
      ? `GREAT ENTRY @ $${diag.suggestedEntry.toFixed(2)} | SL $${diag.suggestedStopLoss.toFixed(2)} | TP $${diag.suggestedTakeProfit.toFixed(2)}`
      : `Watching SSL $${diag.sellSideLiquidity.toFixed(2)} & VWAP $${diag.vwap.toFixed(2)} for sweep`;
  }
}

function syncAssetPills() {
  document.querySelectorAll('#asset-pills .asset-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sym === state.symbol);
  });
}

async function loadMtfMatrix() {
  try {
    const res = await fetchJson(`/api/mtf?symbol=${encodeURIComponent(state.symbol)}`);
    const container = document.getElementById('mtf-matrix');
    container.innerHTML = res.matrix
      .map(item => {
        const cls = item.bias === 'BULLISH' ? 'bull' : item.bias === 'BEARISH' ? 'bear' : '';
        const arrow = item.bias === 'BULLISH' ? '▲' : item.bias === 'BEARISH' ? '▼' : '•';
        return `<span class="mtf-chip ${cls}" title="RSI ${item.rsi} | ADX ${item.adx}">${item.timeframe} ${arrow}</span>`;
      })
      .join('');
  } catch {
    // Non-fatal
  }
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
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.32)' : 'rgba(244, 63, 94, 0.32)'
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

    document.getElementById('metric-symbol').textContent = state.symbol === 'XAU/USD' ? 'XAU/USD · GOLD' : state.symbol;
    document.getElementById('metric-price').textContent = `$${Number(data.ticker.last).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

    const change = Number(data.ticker.changePercent || 0);
    const changeEl = document.getElementById('metric-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    changeEl.className = `change-badge ${change >= 0 ? 'up' : 'down'}`;

    document.getElementById('metric-vwap').textContent = `Session VWAP: $${data.metrics.vwap.toLocaleString()}`;
    const regimeEl = document.getElementById('metric-regime');
    regimeEl.textContent = data.metrics.regime;
    regimeEl.className = `regime-tag ${data.metrics.regimeBadge}`;
    document.getElementById('metric-adx').textContent = `ADX ${data.metrics.adx} · RSI ${data.metrics.rsi} · ATR $${data.metrics.atr}`;
    document.getElementById('metric-ema200').textContent = `200 EMA Anchor: $${data.metrics.ema200 ?? '—'}`;

    const sigEl = document.getElementById('metric-signal');
    sigEl.textContent = data.signal.type;
    sigEl.className = `signal-tag ${data.signal.type.toLowerCase()}`;
    document.getElementById('metric-signal-reason').textContent = data.signal.reason;

    if (data.diagnostics) renderSetupDiagnostics(data.diagnostics);

    clearDynamicPriceLines();
    if (document.getElementById('toggle-liquidity').checked && data.diagnostics) {
      dynamicPriceLines.push(
        candleSeries.createPriceLine({ price: data.diagnostics.buySideLiquidity, color: '#ec4899', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'BSL' }),
        candleSeries.createPriceLine({ price: data.diagnostics.sellSideLiquidity, color: '#38bdf8', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'SSL' })
      );
    }
    if (data.signal.stopLoss || data.diagnostics?.suggestedStopLoss) {
      dynamicPriceLines.push(candleSeries.createPriceLine({ price: data.signal.stopLoss || data.diagnostics.suggestedStopLoss, color: '#f43f5e', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, title: 'SL' }));
    }
    if (data.signal.takeProfit || data.diagnostics?.suggestedTakeProfit) {
      dynamicPriceLines.push(candleSeries.createPriceLine({ price: data.signal.takeProfit || data.diagnostics.suggestedTakeProfit, color: '#10b981', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, title: 'TP' }));
    }

    mainChart.timeScale().fitContent();
    oscillatorChart.timeScale().fitContent();
    if (data.candles.length > 0) {
      state.lastCandleTimeSec = data.candles[data.candles.length - 1].time;
      state.lastTickPrice = Number(data.ticker.last);
    }
    statusEl.textContent = `${data.candles.length} candles`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

function getTimeframeSeconds(tf) {
  const map = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  return map[tf] || 3600;
}

function updateCountdownClock() {
  const el = document.getElementById('candle-countdown');
  if (!el) return;
  const step = getTimeframeSeconds(state.timeframe);
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = step - (nowSec % step);
  const hrs = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  const pad = n => String(n).padStart(2, '0');
  el.textContent = hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function safeSeriesUpdate(series, point, minTime) {
  if (!series || !point || point.time === undefined || point.value === undefined) return;
  if (minTime && point.time < minTime) return;
  try {
    series.update(point);
  } catch {
    // Ignore out-of-order candle edge ticks without breaking live UI
  }
}

function applyLiveTick(tick) {
  if (!tick || !tick.candle) return;
  state.tickSeq += 1;

  // Update active candle & volume bar live without resetting chart zoom
  if (!state.lastCandleTimeSec || tick.candle.time >= state.lastCandleTimeSec) {
    state.lastCandleTimeSec = tick.candle.time;
    try {
      candleSeries.update(tick.candle);
      volumeSeries.update({
        time: tick.candle.time,
        value: tick.candle.volume,
        color: tick.candle.close >= tick.candle.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)'
      });
    } catch {
      // Ignore chart timestamp collision
    }
  }

  // Update tail indicators safely
  safeSeriesUpdate(emaFastSeries, tick.tail?.emaFast, tick.candle.time);
  safeSeriesUpdate(emaSlowSeries, tick.tail?.emaSlow, tick.candle.time);
  safeSeriesUpdate(emaMacroSeries, tick.tail?.emaMacro, tick.candle.time);
  safeSeriesUpdate(vwapSeries, tick.tail?.vwap, tick.candle.time);
  safeSeriesUpdate(vwapUpperSeries, tick.tail?.vwapUpper, tick.candle.time);
  safeSeriesUpdate(vwapLowerSeries, tick.tail?.vwapLower, tick.candle.time);
  safeSeriesUpdate(rsiSeries, tick.tail?.rsi, tick.candle.time);
  safeSeriesUpdate(adxSeries, tick.tail?.adx, tick.candle.time);

  // Flash Price Tick
  const priceEl = document.getElementById('metric-price');
  const newPrice = Number(tick.ticker.last);
  priceEl.textContent = `$${newPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (state.lastTickPrice !== null && newPrice !== state.lastTickPrice) {
    priceEl.classList.remove('price-flash-up', 'price-flash-down');
    void priceEl.offsetWidth;
    priceEl.classList.add(newPrice > state.lastTickPrice ? 'price-flash-up' : 'price-flash-down');
  }
  state.lastTickPrice = newPrice;

  if (tick.ticker && tick.ticker.changePercent !== undefined) {
    const change = Number(tick.ticker.changePercent || 0);
    const changeEl = document.getElementById('metric-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    changeEl.className = `change-badge ${change >= 0 ? 'up' : 'down'}`;
  }

  if (tick.metrics) {
    document.getElementById('metric-vwap').textContent = `Session VWAP: $${tick.metrics.vwap.toLocaleString()}`;
    const regimeEl = document.getElementById('metric-regime');
    regimeEl.textContent = tick.metrics.regime;
    regimeEl.className = `regime-tag ${tick.metrics.regimeBadge}`;
    document.getElementById('metric-adx').textContent = `ADX ${tick.metrics.adx} · RSI ${tick.metrics.rsi} · ATR $${tick.metrics.atr}`;
    document.getElementById('metric-ema200').textContent = `200 EMA Anchor: $${tick.metrics.ema200 ?? '—'}`;
  }

  if (tick.signal) {
    const sigEl = document.getElementById('metric-signal');
    sigEl.textContent = tick.signal.type;
    sigEl.className = `signal-tag ${tick.signal.type.toLowerCase()}`;
    document.getElementById('metric-signal-reason').textContent = tick.signal.reason;
  }

  if (tick.diagnostics) renderSetupDiagnostics(tick.diagnostics);

  if (tick.workerLive) {
    const wl = tick.workerLive;
    document.getElementById('metric-equity').textContent = `$${wl.equity.toFixed(2)}`;
    const unrEl = document.getElementById('metric-unrealized');
    unrEl.textContent = `Unrealized: ${wl.unrealizedPnl >= 0 ? '+' : ''}$${wl.unrealizedPnl.toFixed(2)} (${wl.unrealizedPnlPercent >= 0 ? '+' : ''}${wl.unrealizedPnlPercent.toFixed(2)}%)`;
    unrEl.className = `kpi-sub mono ${wl.unrealizedPnl >= 0 ? 'green' : 'red'}`;

    if (wl.position) {
      renderPositionCard(wl.position, wl.unrealizedPnl, wl.unrealizedPnlPercent, wl.markPrice);
    }
  }

  document.getElementById('chart-status').textContent = `Tick #${state.tickSeq} · ${new Date(tick.timestamp).toLocaleTimeString()}`;
}

function stopLiveStream() {
  if (liveStreamTimer) {
    clearInterval(liveStreamTimer);
    liveStreamTimer = null;
  }
  const pill = document.getElementById('stream-status-pill');
  const btn = document.getElementById('btn-toggle-stream');
  if (pill) {
    pill.classList.remove('active');
    pill.innerHTML = '<span class="pulse-dot"></span> PAUSED';
  }
  if (btn) btn.textContent = 'Resume';
}

function startLiveStream() {
  stopLiveStream();
  if (!state.streamEnabled) return;

  const pill = document.getElementById('stream-status-pill');
  const btn = document.getElementById('btn-toggle-stream');
  if (pill) {
    pill.classList.add('active');
    pill.innerHTML = '<span class="pulse-dot"></span> LIVE · 650ms';
  }
  if (btn) btn.textContent = 'Pause';

  const runTick = async () => {
    if (!state.streamEnabled || document.hidden || liveTickInFlight) return;
    liveTickInFlight = true;
    try {
      const s = getSettingsFromUI();
      const qs = new URLSearchParams({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategy: state.strategy,
        fastEma: String(s.fastEmaPeriod),
        slowEma: String(s.slowEmaPeriod),
        macroEma: String(s.macroEmaPeriod),
        lookback: String(s.liquidityLookback),
        minWick: String(s.minWickRatio),
        rr: String(s.riskRewardRatio)
      });
      const tick = await fetchJson(`/api/live-tick?${qs.toString()}`);
      applyLiveTick(tick);
    } catch {
      // Keep polling across transient hiccups
    } finally {
      liveTickInFlight = false;
    }
  };

  void runTick();
  liveStreamTimer = setInterval(() => {
    void runTick();
  }, 650);
}

async function runBacktest() {
  const btn = document.getElementById('btn-run-backtest');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running...';
  }
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
      markers.push({ time: t.entryTimeSec, position: 'belowBar', color: '#10b981', shape: 'arrowUp', text: `BUY` });
      markers.push({ time: t.exitTimeSec, position: 'aboveBar', color: t.pnl >= 0 ? '#fbbf24' : '#f43f5e', shape: 'arrowDown', text: `${t.pnl >= 0 ? '+' : ''}${t.pnlPercent.toFixed(1)}%` });
    }
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);

    equitySeries.setData(res.equityCurve.map(p => ({ time: p.time, value: p.value })));
    drawdownSeries.setData(res.equityCurve.map(p => ({ time: p.time, value: p.drawdown })));
    equityChart.timeScale().fitContent();

    document.getElementById('equity-summary').textContent = `$${res.finalBalance.toFixed(2)} (${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%)`;

    const retEl = document.getElementById('bt-return');
    retEl.textContent = `${res.totalPnlPercent >= 0 ? '+' : ''}${res.totalPnlPercent.toFixed(2)}%`;
    retEl.className = `big-stat mono ${res.totalPnlPercent >= 0 ? 'green' : 'red'}`;

    document.getElementById('bt-winrate').textContent = `${res.winRate.toFixed(1)}%`;
    document.getElementById('bt-pf').textContent = `${res.profitFactor}`;
    document.getElementById('bt-dd').textContent = `${res.maxDrawdownPercent.toFixed(2)}%`;
    document.getElementById('bt-trade-count').textContent = res.totalTrades;

    const tbody = document.getElementById('bt-trades-tbody');
    if (res.trades.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No trades triggered in this window (Capital preserved).</td></tr>';
    } else {
      tbody.innerHTML = res.trades
        .slice()
        .reverse()
        .map((t, idx) => `
          <tr>
            <td class="mono">#${res.trades.length - idx}</td>
            <td><span class="signal-tag buy">${t.type}</span></td>
            <td class="mono">$${t.entryPrice.toFixed(2)}</td>
            <td class="mono">$${t.exitPrice.toFixed(2)}</td>
            <td class="mono ${t.pnl >= 0 ? 'green' : 'red'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
            <td class="mono ${t.pnl >= 0 ? 'green' : 'red'}">${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%</td>
            <td>${t.exitReason}</td>
          </tr>
        `)
        .join('');
    }
  } catch (err) {
    showToast(`Backtest error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '▶ Re-Run Backtest';
    }
  }
}

async function scanSetups() {
  const tbody = document.getElementById('scanner-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">Scanning markets...</td></tr>';
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
        const score = d ? d.score : 0;
        return `
          <tr>
            <td><strong>${item.symbol}</strong></td>
            <td class="mono">$${Number(item.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td><span class="model-chip mono">${score}%</span></td>
            <td>${d ? d.sweepType : 'NONE'}</td>
            <td class="mono">${d ? `$${d.sellSideLiquidity.toFixed(1)} / $${d.buySideLiquidity.toFixed(1)}` : '—'}</td>
            <td class="mono">${d ? `$${d.vwap.toFixed(1)}` : '—'}</td>
            <td><span class="signal-tag ${item.signal.toLowerCase()}">${item.signal}</span></td>
            <td>
              <button class="chip-btn" onclick="selectScannedAsset('${item.symbol}')">Inspect</button>
              <button class="chip-btn" onclick="quickPaperBuy('${item.symbol}')">Buy</button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-msg">Error: ${err.message}</td></tr>`;
  }
}

window.selectScannedAsset = async function selectScannedAsset(symbol) {
  state.symbol = symbol;
  syncAssetPills();
  switchView('terminal');
  await Promise.all([loadMarket(), loadMtfMatrix(), runBacktest()]);
  startLiveStream();
  showToast(`Loaded ${symbol} live stream`);
};

window.quickPaperBuy = async function quickPaperBuy(symbol) {
  const res = await fetchJson('/api/webhook/tradingview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, action: 'BUY', timeframe: state.timeframe })
  });
  renderWorkerState(res.workerState);
  showToast(`Paper BUY executed on ${symbol}`);
};

function switchView(viewId) {
  state.activeView = viewId;
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  document.querySelectorAll('.view-pane').forEach(p => p.classList.toggle('active', p.id === `view-${viewId}`));

  if (viewId === 'terminal') setTimeout(resizeCharts, 50);
  if (viewId === 'tvpro') renderTradingViewProWidget();
}

function renderPositionCard(position, unrealizedPnl, unrealizedPnlPercent, markPrice) {
  const posBox = document.getElementById('position-box');
  if (!posBox) return;
  if (position) {
    const pnlSign = unrealizedPnl >= 0 ? '+' : '';
    const pctSign = unrealizedPnlPercent >= 0 ? '+' : '';
    const cls = unrealizedPnl >= 0 ? 'green' : 'red';
    posBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <strong>LONG ${position.symbol}</strong>
        <strong class="mono ${cls}">${pnlSign}$${unrealizedPnl.toFixed(2)} (${pctSign}${unrealizedPnlPercent.toFixed(2)}%)</strong>
      </div>
      <div class="muted mono">Entry: $${position.entryPrice.toFixed(2)} → Mark: $${Number(markPrice || position.entryPrice).toFixed(2)}</div>
      <div class="muted mono">Qty: ${position.amount.toFixed(4)} · SL: $${(position.stopLoss || 0).toFixed(2)} · TP: $${(position.takeProfit || 0).toFixed(2)}</div>
    `;
  } else {
    posBox.innerHTML = `<div class="empty-msg">Flat (${state.symbol}) — Ready for setup</div>`;
  }
}

function renderWorkerState(w) {
  const badge = document.getElementById('worker-badge');
  badge.textContent = w.running ? 'RUNNING' : 'STOPPED';
  badge.className = `status-badge ${w.running ? 'running' : ''}`;

  const headerPill = document.getElementById('header-bot-pill');
  headerPill.classList.toggle('active', w.running);
  document.getElementById('header-bot-text').textContent = w.running ? `LIVE · ${w.symbol}` : 'STANDBY';

  document.getElementById('btn-worker-start').disabled = w.running;
  document.getElementById('btn-worker-stop').disabled = !w.running;
  document.getElementById('worker-strategy-label').textContent = w.strategyName;

  document.getElementById('worker-cash').textContent = `$${w.cashBalance.toFixed(2)}`;
  const realEl = document.getElementById('worker-realized');
  const realPnl = w.realizedPnl || 0;
  realEl.textContent = `${realPnl >= 0 ? '+' : ''}$${realPnl.toFixed(2)}`;
  realEl.className = realPnl >= 0 ? 'green' : 'red';

  document.getElementById('metric-equity').textContent = `$${w.equity.toFixed(2)}`;
  document.getElementById('metric-winrate').textContent = `WR: ${(w.winRate || 0).toFixed(1)}% (${(w.trades || []).length}t)`;

  const unrEl = document.getElementById('metric-unrealized');
  unrEl.textContent = `Unrealized: ${w.unrealizedPnl >= 0 ? '+' : ''}$${w.unrealizedPnl.toFixed(2)} (${(w.unrealizedPnlPercent || 0) >= 0 ? '+' : ''}${(w.unrealizedPnlPercent || 0).toFixed(2)}%)`;
  unrEl.className = `kpi-sub mono ${w.unrealizedPnl >= 0 ? 'green' : 'red'}`;

  renderPositionCard(w.position, w.unrealizedPnl, w.unrealizedPnlPercent || 0, w.lastPrice);

  const paperTradesEl = document.getElementById('paper-trades-list');
  if (paperTradesEl) {
    const trades = w.trades || [];
    if (trades.length === 0) {
      paperTradesEl.innerHTML = '<div class="empty-msg">No closed paper trades yet</div>';
    } else {
      paperTradesEl.innerHTML = trades
        .slice(0, 15)
        .map(t => `
          <div class="feed-item ${t.pnl >= 0 ? 'TRADE' : 'ERROR'}">
            <div style="display:flex;justify-content:space-between;">
              <strong>LONG $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)}</strong>
              <strong class="mono ${t.pnl >= 0 ? 'green' : 'red'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} (${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%)</strong>
            </div>
            <div class="muted">${t.exitReason}</div>
          </div>
        `)
        .join('');
    }
  }

  const logsEl = document.getElementById('worker-logs');
  logsEl.innerHTML = (w.logs || [])
    .slice(0, 18)
    .map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `<div class="feed-item ${log.level}"><span class="mono muted">[${time}]</span> ${log.message}</div>`;
    })
    .join('');
}

async function refreshWorkerStatus() {
  try {
    const w = await fetchJson('/api/worker/status');
    renderWorkerState(w);
  } catch {
    // Ignore transient poll errors
  }
}

function bindEvents() {
  document.querySelectorAll('.rail-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('#asset-pills .asset-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.symbol = btn.dataset.sym;
      syncAssetPills();
      await Promise.all([loadMarket(), loadMtfMatrix(), runBacktest()]);
      startLiveStream();
      if (state.activeView === 'tvpro') renderTradingViewProWidget();
    });
  });

  document.querySelectorAll('#timeframe-pills .seg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#timeframe-pills .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.timeframe = btn.dataset.tf;
      await Promise.all([loadMarket(), runBacktest(), scanSetups()]);
      startLiveStream();
      if (state.activeView === 'tvpro') renderTradingViewProWidget();
    });
  });

  document.getElementById('strategy-select').addEventListener('change', async e => {
    state.strategy = e.target.value;
    await Promise.all([loadMarket(), runBacktest()]);
    startLiveStream();
    showToast(`Switched model to ${e.target.options[e.target.selectedIndex].text}`);
  });

  document.getElementById('btn-toggle-stream').addEventListener('click', () => {
    state.streamEnabled = !state.streamEnabled;
    if (state.streamEnabled) {
      startLiveStream();
      showToast('Live 2s stream resumed');
    } else {
      stopLiveStream();
      showToast('Live stream paused');
    }
  });

  document.getElementById('toggle-emas').addEventListener('change', applyLayerVisibility);
  document.getElementById('toggle-vwap').addEventListener('change', applyLayerVisibility);
  document.getElementById('toggle-liquidity').addEventListener('change', loadMarket);

  document.getElementById('btn-tv-analyze').addEventListener('click', async () => {
    const urlOrSymbol = document.getElementById('tv-url-input').value.trim();
    if (!urlOrSymbol) return;
    try {
      const res = await fetchJson('/api/tv/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrSymbol, timeframe: state.timeframe, action: 'ANALYZE' })
      });
      state.symbol = res.parsed.symbol;
      if (res.timeframe) state.timeframe = res.timeframe;
      syncAssetPills();
      renderWorkerState(res.workerState);
      await Promise.all([loadMarket(), loadMtfMatrix(), runBacktest()]);
      startLiveStream();
      showToast(`Analyzed ${state.symbol} (${state.timeframe})`);
    } catch (err) {
      showToast(`Analyze failed: ${err.message}`);
    }
  });

  document.getElementById('tv-url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-tv-analyze').click();
  });

  document.getElementById('btn-take-setup').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'BUY', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
    showToast(`Opened Paper LONG on ${state.symbol}`);
  });

  document.getElementById('btn-close-setup').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'SELL', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
    showToast(`Closed Paper Position on ${state.symbol}`);
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
    showToast(`Auto-Bot started on ${state.symbol}`);
  });

  document.getElementById('btn-worker-stop').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/stop', { method: 'POST' });
    renderWorkerState(w);
    showToast('Auto-Bot paused');
  });

  document.getElementById('btn-worker-tick').addEventListener('click', async () => {
    const w = await fetchJson('/api/worker/tick', { method: 'POST' });
    renderWorkerState(w);
    showToast('Executed live market tick');
  });

  document.getElementById('btn-worker-reset').addEventListener('click', async () => {
    const s = getSettingsFromUI();
    const w = await fetchJson('/api/worker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialBalance: s.initialBalance })
    });
    renderWorkerState(w);
    showToast(`Paper wallet reset to $${s.initialBalance}`);
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
      showToast(`Applied ${btn.dataset.preset} preset`);
    });
  });

  document.getElementById('btn-apply-settings').addEventListener('click', async () => {
    const settings = getSettingsFromUI();
    await fetchJson('/api/worker/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, timeframe: state.timeframe, strategyId: state.strategy, settings })
    });
    await Promise.all([loadMarket(), runBacktest(), scanSetups()]);
    startLiveStream();
    showToast('Settings applied & live stream updated');
  });

  document.getElementById('btn-reset-settings').addEventListener('click', async () => {
    applyPreset('balanced');
    await Promise.all([loadMarket(), runBacktest()]);
    showToast('Settings restored to defaults');
  });

  document.getElementById('btn-scan-setups').addEventListener('click', scanSetups);
  document.getElementById('btn-run-backtest').addEventListener('click', runBacktest);
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await Promise.all([loadMarket(), loadMtfMatrix(), refreshWorkerStatus(), scanSetups()]);
    showToast('Dashboard data refreshed');
  });

  document.getElementById('btn-copy-webhook').addEventListener('click', () => {
    navigator.clipboard?.writeText(document.getElementById('webhook-url').textContent);
    showToast('Webhook URL copied');
  });

  document.getElementById('btn-copy-json').addEventListener('click', () => {
    navigator.clipboard?.writeText(document.getElementById('webhook-json-preview').textContent);
    showToast('Alert JSON copied');
  });

  document.getElementById('btn-sim-buy').addEventListener('click', () => quickPaperBuy(state.symbol));
  document.getElementById('btn-sim-sell').addEventListener('click', async () => {
    const res = await fetchJson('/api/webhook/tradingview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: state.symbol, action: 'SELL', timeframe: state.timeframe })
    });
    renderWorkerState(res.workerState);
    showToast(`Test SELL alert executed on ${state.symbol}`);
  });

  document.getElementById('btn-send-telegram-setup').addEventListener('click', async () => {
    const res = await fetchJson('/api/alerts/telegram/send-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        timeframe: state.timeframe,
        strategyId: state.strategy,
        settings: getSettingsFromUI()
      })
    });
    if (res.sent) {
      showToast(`📩 Entry/SL/TP sent to Telegram for ${state.symbol}`);
    } else {
      showToast(`Telegram not sent: ${res.reason} (Configure in Studio)`);
    }
  });

  document.getElementById('btn-save-telegram').addEventListener('click', async () => {
    try {
      const cfg = await fetchJson('/api/alerts/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: document.getElementById('tg-bot-token').value.trim(),
          chatId: document.getElementById('tg-chat-id').value.trim(),
          minScore: Number(document.getElementById('tg-min-score').value || 75),
          cooldownMinutes: Number(document.getElementById('tg-cooldown').value || 15),
          enabled: document.getElementById('tg-enabled').checked
        })
      });
      renderTelegramConfig(cfg);
      showToast('Telegram alert settings saved');
    } catch (err) {
      showToast(`Save failed: ${err.message}`);
    }
  });

  document.getElementById('btn-test-telegram').addEventListener('click', async () => {
    try {
      await fetchJson('/api/alerts/telegram/test', { method: 'POST' });
      showToast('✅ Test message delivered to Telegram!');
    } catch (err) {
      showToast(`Telegram test failed: ${err.message}`);
    }
  });
}

function renderTelegramConfig(cfg) {
  const badge = document.getElementById('tg-status-badge');
  if (badge) {
    badge.textContent = cfg.configured && cfg.enabled ? 'ACTIVE' : cfg.configured ? 'PAUSED' : 'NOT SET';
    badge.className = `status-badge ${cfg.configured && cfg.enabled ? 'running' : ''}`;
  }
  const tokenEl = document.getElementById('tg-bot-token');
  const chatEl = document.getElementById('tg-chat-id');
  const scoreEl = document.getElementById('tg-min-score');
  const coolEl = document.getElementById('tg-cooldown');
  const enEl = document.getElementById('tg-enabled');

  if (tokenEl && cfg.maskedToken) tokenEl.value = cfg.maskedToken;
  if (chatEl && cfg.chatId) chatEl.value = cfg.chatId;
  if (scoreEl) scoreEl.value = cfg.minScore;
  if (coolEl) coolEl.value = cfg.cooldownMinutes;
  if (enEl) enEl.checked = cfg.enabled;
}

async function loadTelegramConfig() {
  try {
    const cfg = await fetchJson('/api/alerts/telegram/config');
    renderTelegramConfig(cfg);
  } catch {
    // Ignore
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const webhookEl = document.getElementById('webhook-url');
  if (webhookEl) webhookEl.textContent = `${window.location.origin}/api/webhook/tradingview`;

  const params = new URLSearchParams(window.location.search);
  const urlSymbol = params.get('symbol');
  const urlView = params.get('view');
  if (urlSymbol) state.symbol = urlSymbol;
  syncAssetPills();

  initCharts();
  bindEvents();

  // Render live price chart & start real-time 650ms stream immediately without blocking
  await loadMarket();
  startLiveStream();
  updateCountdownClock();
  setInterval(updateCountdownClock, 1000);

  if (urlView) switchView(urlView);

  // Load secondary analytics, MTF matrix, and scanner in background
  void refreshWorkerStatus();
  void loadTelegramConfig();
  void runBacktest();
  void loadMtfMatrix();
  setTimeout(() => void scanSetups(), 1200);
  setInterval(refreshWorkerStatus, 5000);
});
