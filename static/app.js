"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const num = (v, d = 2) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? "–"
    : Number(v).toLocaleString(undefined, {minimumFractionDigits: d, maximumFractionDigits: d});
  const signed = (v, d = 2) => (v === null || v === undefined) ? "–" : `<span class="${Number(v) > 0 ? "good" : Number(v) < 0 ? "bad" : ""}">${Number(v) > 0 ? "+" : ""}${num(v, d)}</span>`;
  const time = (ts) => ts ? new Date(ts * 1000).toLocaleString() : "–";
  const age = (s) => s === null || s === undefined ? "–" : s < 90 ? `${s.toFixed(0)}s` : s < 5400 ? `${(s / 60).toFixed(0)}m` : `${(s / 3600).toFixed(1)}h`;
  const LABELS = {spot: "A · MEXC BTC/USDT spot", xarb: "B · MEXC/Binance arbitrage", p2p: "C · MYR/USDT/NGN P2P monitor"};
  let chartHours = 24, lastState = null, dataMode = null;
  const charts = {};

  let csrf = null, role = null, ent = null;   // ent: the customer's plan entitlements from /api/account
  const isStaff = () => role === "owner" || role === "admin";
  function setOffline(off) { $("offlineBanner").classList.toggle("hidden", !off); }
  async function api(path, opts = {}) {
    const headers = {"Content-Type": "application/json"};
    if (csrf && opts.method && opts.method !== "GET") headers["X-CSRF-Token"] = csrf;
    let r;
    try { r = await fetch(path, {credentials: "same-origin", headers, ...opts}); }
    catch (e) { setOffline(true); throw new Error("offline"); }
    setOffline(false);
    if (r.status === 401) { location.replace("./"); throw new Error("signed out"); }
    if (!r.ok) {
      let msg = `${r.status}`;
      try { msg = (await r.json()).detail || msg; } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    return r.json();
  }

  // numeric: column indexes to right-align; a row array may carry .cls (e.g. "dim" for stale feeds)
  function table(el, headers, rows, numeric = [], empty = "Nothing yet") {
    const cls = (i, c) => [numeric.includes(i) ? "num" : "", c && c.wrap ? "wrap" : ""].filter(Boolean).join(" ");
    const attr = (i, c) => cls(i, c) ? ` class="${cls(i, c)}"` : "";
    el.innerHTML = `<thead><tr>${headers.map((h, i) => `<th${attr(i)}>${esc(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.length ? rows.map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ""}>${r.map((c, i) => `<td${attr(i, c)}>${c && c.html !== undefined ? c.html : esc(c)}</td>`).join("")}</tr>`).join("") :
        `<tr><td colspan="${headers.length}" class="empty">${esc(empty)}</td></tr>`}</tbody>`;
  }
  const rowCls = (row, cls) => Object.assign(row, {cls});
  const H = (html) => ({html});
  const W = (text) => ({html: esc(text), wrap: true});

  // Styled confirmation in place of window.confirm(): resolves true only when Confirm is pressed.
  // Cancel, Escape or clicking outside resolves false, so nothing is sent.
  function ask(text, {title = "Please confirm", ok = "Confirm", danger = false, cancel = "Cancel"} = {}) {
    const d = $("askDialog");
    if (!d || typeof d.showModal !== "function") return Promise.resolve(window.confirm(text));
    $("askTitle").textContent = title;
    $("askText").textContent = text;
    $("askOk").textContent = ok;
    $("askOk").className = `btn ${danger ? "danger" : "primary"}`;
    $("askCancel").textContent = cancel;
    $("askCancel").hidden = cancel === null;
    d.returnValue = "cancel";
    return new Promise((resolve) => {
      d.addEventListener("close", () => resolve(d.returnValue === "ok"), {once: true});
      d.showModal();
      $(danger && cancel !== null ? "askCancel" : "askOk").focus();   // a risky action starts on Cancel
    });
  }
  const tell = (text, title = "Something went wrong") => ask(text, {title, ok: "OK", cancel: null});
  document.addEventListener("click", (ev) => {     // a click on the backdrop closes the dialog as Cancel
    const d = $("askDialog");
    if (ev.target === d) d.close("cancel");
  });

  function renderState(s) {
    lastState = s;
    const p = s.portfolio;
    const sim = s.data_mode === "simulated";
    dataMode = s.data_mode;
    $("dataMode").textContent = sim ? "SIMULATED DATA" : "LIVE PUBLIC DATA";
    $("dataMode").className = `badge ${sim ? "mode-sim" : "mode-live"}`;
    $("simBanner").classList.toggle("hidden", !sim);
    $("welcomeSource").textContent = sim ? "simulated prices generated on this server" : "real public market prices";
    const hb = s.worker_heartbeat_age_s;
    const starts = s.worker && s.worker.starts ? ` · start #${esc(s.worker.starts)}` : "";
    $("worker").innerHTML = hb === null ? '<span class="pulse bad"></span><span class="bad">worker never ran</span>' :
      hb > 60 ? `<span class="pulse bad"></span><span class="bad">worker down (${age(hb)} ago)</span>` : `<span class="pulse"></span>worker ok · ${age(hb)} ago${starts}`;
    const stop = !!s.controls.emergency_stop;
    $("stopBanner").classList.toggle("hidden", !stop);
    for (const id of ["estop", "estop2"]) {
      $(id).textContent = stop ? "Release emergency stop" : "Emergency stop";
      $(id).classList.toggle("danger", !stop);
    }

    const k = [];
    if (!p.funded) {
      const [head, sub] = role !== "customer" ? ["Not funded", "Waiting for a USD/MYR rate to convert RM capital"]
        : ent && !ent.active ? ["Paused", "Choose a plan in Settings to start your simulated account"]
        : ["Starting", "Your simulated account is being set up. This takes a few seconds."];
      k.push(`<div class="kpi"><div class="label">Simulated account</div><div class="value warn">${head}</div><div class="sub">${sub}</div></div>`);
    } else {
      k.push(`<div class="kpi"><div class="label">Simulated net P/L</div><div class="value">${signed(p.pnl_myr)}</div><div class="sub">${signed(p.pnl_pct)} % after costs</div></div>`);
      k.push(`<div class="kpi"><div class="label">Available</div><div class="value">${num(p.available_usdt)} USDT</div><div class="sub">+ RM ${num(p.available_myr)} reserve</div></div>`);
      k.push(`<div class="kpi"><div class="label">Fees paid</div><div class="value">RM ${num(p.fees_myr)}</div><div class="sub">taker fees, all strategies</div></div>`);
      k.push(`<div class="kpi"><div class="label">Max drawdown</div><div class="value">${num(p.max_drawdown_pct)} %</div><div class="sub">allocated capital</div></div>`);
      k.push(`<div class="kpi"><div class="label">Funding rate</div><div class="value">${num(p.funding.myr_per_usdt, 4)}</div><div class="sub">MYR/USDT, fixed for reporting</div></div>`);
    }
    $("kpis").innerHTML = k.join("");
    $("equityHead").innerHTML = p.funded ? `<div class="equity-value">RM ${num(p.equity_myr)}</div>
      <div class="small">${signed(p.pnl_myr)} RM (${signed(p.pnl_pct)} %) since the start of RM ${num(p.initial_capital_myr)}</div>` : "";
    $("equityMark").textContent = sim ? "USDT, marked at the simulated best bid" : "USDT, marked at the real best bid";

    $("feedsNote").textContent = sim ? "Simulated BTC/USDT order books generated on this server; no exchange is contacted"
      : "Real BTC/USDT order books from public exchange data";
    table($("feeds"), ["Venue", "Status", "Bid", "Ask", "Spread bps", "Depth ±10bps bid/ask (USDT)", "Depth ±50bps bid/ask (USDT)", "Last update", "Latency", "Failures / reconnects", "Source / error"],
      s.feeds.map((f) => {
        const simRow = f.status === "SIMULATED", gone = f.status === "STALE" || f.status === "UNAVAILABLE";
        const row = [f.venue.toUpperCase(), H(`<span class="st ${esc(f.status)}">${esc(f.status)}</span>`), num(f.bid), num(f.ask), num(f.spread_bps),
          `${num(f.depth_bid_10bps_usdt, 0)} / ${num(f.depth_ask_10bps_usdt, 0)}`, `${num(f.depth_bid_50bps_usdt, 0)} / ${num(f.depth_ask_50bps_usdt, 0)}`,
          `${gone ? "last seen " : ""}${age(f.age_s)} ago`, simRow || f.latency_ms === null ? "–" : `${num(f.latency_ms, 0)} ms`, `${f.total_failures ?? 0} / ${f.reconnects ?? 0}`,
          W(f.last_error ? `⚠ ${f.last_error}` : simRow ? "Simulator (no exchange)" : (f.endpoint || ""))];
        return gone ? rowCls(row, "dim") : row;
      }), [2, 3, 4, 5, 6, 8, 9]);

    const rm = (s.risk && s.risk.metrics) || {};
    const meter = (v, lim) => {
      const f = lim > 0 ? Math.max(0, Math.min(1, Number(v) / Number(lim))) : 0;
      return `<span class="meter" aria-hidden="true"><i class="${f >= 1 ? "bad" : f >= 0.8 ? "warn" : ""}" style="width:${(f * 100).toFixed(0)}%"></i></span>`;
    };
    const rrow = (label, m, keys) => m ? [label, ...keys.map(([k, lk]) => H(`${num(m[k])} % <span class="muted">/ ${num(m.limits[lk || k])} %</span>${meter(m[k], m.limits[lk || k])}`)), W(m.blocked || "")] : null;
    table($("risk"), ["Scope", "Daily loss / limit", "Drawdown / limit", "Position or exposure / limit", "Entries paused because"], [
      rrow("Overall", rm.global, [["daily_loss_pct"], ["drawdown_pct"], ["btc_exposure_pct"]]),
      rrow(LABELS.spot, rm.spot, [["daily_loss_pct"], ["drawdown_pct"], ["position_pct"]]),
      rrow(LABELS.xarb, rm.xarb, [["daily_loss_pct"], ["drawdown_pct"], ["position_pct"]]),
    ].filter(Boolean).map((r, i) => i === 0 && s.risk.latched.global ? [...r.slice(0, 4), W(s.risk.latched.global)] : r));

    $("stratCards").innerHTML = ["spot", "xarb", "p2p"].map((name) => {
      const st = p.strategies[name] || {};
      const on = s.controls[`enabled_${name}`] !== false;
      let extra = "";
      if (name === "spot") {
        const bh = st.buy_hold;
        const ind = st.indicators;
        extra = `<dt>Buy &amp; hold</dt><dd>${bh ? `${signed(bh.return_pct)} %` : "–"}</dd>
          <dt>Position</dt><dd>${st.position ? `${num(st.position.qty, 6)} BTC @ ${num(st.position.entry_price)}` : "flat"}</dd>
          <dt>EMA20 / EMA50</dt><dd>${ind ? `${num(ind.ema_fast, 0)} / ${num(ind.ema_slow, 0)}` : "–"}</dd>
          <dt>RSI14</dt><dd>${ind && ind.rsi ? num(ind.rsi, 1) : "–"}</dd>`;
      }
      if (name === "xarb") extra = `<dt>Settlement est.</dt><dd>${num(st.settlement_usdt, 4)} USDT</dd>`;
      const holds = name !== "p2p";
      return `<div class="card strat"><div class="card-head"><h3>${esc(LABELS[name])}</h3>
        ${name === "p2p" && !isStaff() ? '<span class="badge">OWNER ONLY</span>'
          : !isStaff() && ent && !ent.features[`strategy_${name}`] ? '<a class="badge" href="#settings">NOT IN YOUR PLAN</a>'
          : `<label class="switch"><input type="checkbox" data-strat="${name}" ${on ? "checked" : ""}> enabled</label>`}</div>
        <div><span class="health ${esc(st.health || "stopped")}">${esc(st.health || "not started")}</span>
          ${st.consecutive_errors ? `<span class="bad small"> ${st.consecutive_errors} error(s) in a row</span>` : ""}</div>
        <div class="status">${esc(name === "p2p" && !isStaff() ? "Available to the owner only during launch." : st.status || "not started")}</div>
        ${st.last_error && st.consecutive_errors ? `<div class="status bad">${esc(st.last_error)}</div>` : ""}
        <dl>${holds ? `<dt>Allocated</dt><dd>${num(st.allocated_usdt)} USDT</dd>
          <dt>Equity</dt><dd>${num(st.equity_usdt)} USDT</dd>
          <dt>P/L</dt><dd>${signed(st.pnl_usdt, 4)} USDT (${st.return_pct === null ? "–" : signed(st.return_pct)} %)</dd>
          <dt>Fees</dt><dd>${num(st.fees_usdt, 4)} USDT</dd>
          <dt>Slippage vs best</dt><dd>${num(st.slippage_usdt, 4)} USDT</dd>
          <dt>Realized / unrealized</dt><dd>${signed(st.realized_usdt, 4)} / ${signed(st.unrealized_usdt, 4)}</dd>
          <dt>Closed trades / win rate</dt><dd>${st.closed_trades || 0} / ${st.win_rate_pct === null || st.win_rate_pct === undefined ? "–" : num(st.win_rate_pct, 1) + " %"}</dd>
          <dt>BTC exposure</dt><dd>${num(st.exposure_usdt)} USDT (${num(st.exposure_pct, 1)} %)</dd>
          <dt>Max drawdown</dt><dd>${num(st.max_drawdown_pct)} %</dd>` : `<dt>Capital</dt><dd>none (monitor only)</dd>`}
          <dt>Rejected / failed</dt><dd>${st.rejections || 0}</dd>${extra}</dl></div>`;
    }).join("");

    const alloc = [];
    alloc.push(["Reserve (unallocated)", "treasury", "MYR", num(p.unallocated_myr), ""]);
    for (const name of ["spot", "xarb"]) {
      const st = p.strategies[name] || {};
      for (const [key, amt] of Object.entries(st.balances || {})) {
        const [venue, asset] = key.split(":");
        alloc.push([LABELS[name], venue, asset, num(amt, asset === "BTC" ? 6 : 4), asset === "BTC" ? "open BTC inventory/position" : ""]);
      }
    }
    $("stratSummary").innerHTML = ["spot", "xarb", "p2p"].map((name) => {
      const st = p.strategies[name] || {};
      const on = s.controls[`enabled_${name}`] !== false;
      return `<a class="card mini" href="#strategies"><div class="card-head"><h3>${esc(LABELS[name])}</h3>
        <span class="health ${esc(on ? st.health || "off" : "off")}">${esc(on ? st.health || (ent && !ent.active ? "paused" : "not started") : "off")}</span></div>
        ${name === "p2p" ? `<div class="small muted">${esc(st.status || "monitor only")}</div>` :
          `<div class="value">${signed(st.pnl_usdt, 2)} <span class="small muted">USDT</span></div>
           <div class="small muted">${st.closed_trades || 0} closed trades · exposure ${num(st.exposure_pct, 1)} %</div>`}</a>`;
    }).join("");

    table($("alloc"), ["Strategy", "Venue", "Asset", "Balance", "Note"], alloc, [3]);
    lastErrors = s.errors;
    renderAlerts();
    const n = s.notifications;
    $("notify").innerHTML = `<div class="notify-grid">
      <div><strong>Telegram</strong><div>${n.telegram_configured ? "Token set" : '<span class="bad">TELEGRAM_BOT_TOKEN not set</span>'}</div><div class="muted">Alerts ${n.telegram_alerts_on ? "on" : "off"}</div></div>
      <div><strong>Gmail</strong><div>${n.email_configured ? "Credentials set" : '<span class="muted">Not configured</span>'}</div><div class="muted">Alerts ${n.email_alerts_on ? "on" : "off"}</div></div>
      </div><span class="muted">Secrets are never shown here.</span>`;
    $("testTg").disabled = !n.telegram_configured;
    $("testTg").title = n.telegram_configured ? "" : "Set TELEGRAM_BOT_TOKEN on the server first";
    $("testMail").disabled = !n.email_configured;
    $("testMail").title = n.email_configured ? "" : "Gmail is not configured on the server";
  }

  // Time axis: pinned to [now - range, now], ticks on round local hours, so the chart never runs ahead of the clock.
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ""; } })();
  function hourTicks(min, max, stepH) {
    // ticks on round local times: every 30 min, or every 1/4/12 hours counted from local midnight
    const stepMin = Math.round(stepH * 60), out = [], d = new Date(min);
    d.setSeconds(0, 0);
    while (d.getTime() < min || (d.getHours() * 60 + d.getMinutes()) % stepMin) d.setMinutes(d.getMinutes() + 1);
    for (; d.getTime() <= max; d.setMinutes(d.getMinutes() + stepMin)) out.push({value: d.getTime()});
    return out;
  }
  function tickLabel(v, stepH) {
    const d = new Date(v), hm = d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    const date = d.toLocaleDateString([], {day: "numeric", month: "short"});
    if (stepH >= 12) return `${date} ${hm}`;
    return d.getHours() === 0 && stepH >= 2 ? date : hm;
  }
  const tipTime = (x) => new Date(x).toLocaleString([], {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short"});
  // a null point breaks the line, so a gap in the data shows as a gap instead of a straight line across it
  function withGaps(points, maxGapMs) {
    const out = [];
    points.forEach((pt, i) => {
      if (i && pt.x - points[i - 1].x > maxGapMs) out.push({x: points[i - 1].x + 1, y: null});
      out.push(pt);
    });
    return out;
  }
  const emptyMsg = () => dataMode === "simulated" ? "No history yet. The chart fills in as the simulation runs." : "No data for this period yet.";
  function chartState(id, state, msg) {
    const box = $(id) && $(id).parentElement;
    if (!box) return;
    if (state) { box.dataset.state = state; box.dataset.msg = msg; } else { delete box.dataset.state; delete box.dataset.msg; }
  }
  function uaName(ua) {
    if (!ua) return "Unknown device";
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /(Chrome|CriOS)\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac"
      : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${browser} on ${os}` : browser;
  }
  // Chart colours are fixed per series (not the accent), so a series keeps its colour whatever theme is chosen.
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function lineChart(id, datasets, {yLabel = "", min, max, stepH = 4} = {}) {
    const ctx = $(id);
    if (!window.Chart || !ctx) return;
    const empty = datasets.filter((d) => !d.guide).every((d) => !d.data || !d.data.some((pt) => pt.y !== null));
    chartState(id, empty ? "empty" : null, emptyMsg());
    const text = cssVar("--muted"), grid = cssVar("--line"), card = cssVar("--card"), fg = cssVar("--text");
    const x = {type: "linear", min, max, grid: {color: grid}, border: {color: grid},
      ticks: {color: text, autoSkip: true, maxRotation: 0, callback: (v) => tickLabel(v, stepH)},
      afterBuildTicks: (scale) => { if (min !== undefined && max !== undefined) scale.ticks = hourTicks(min, max, stepH); }};
    if (charts[id]) {
      charts[id].data.datasets = datasets;
      charts[id].options.scales.x = x;
      charts[id].update("none");
      return;
    }
    Chart.defaults.font.family = '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif';
    charts[id] = new Chart(ctx, {
      type: "line", data: {datasets},
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, parsing: false, normalized: true, spanGaps: false,
        interaction: {mode: "nearest", intersect: false},
        scales: {
          x,
          y: {ticks: {color: text}, grid: {color: grid}, border: {display: false}, title: {display: !!yLabel, text: yLabel, color: text}},
        },
        plugins: {
          legend: {labels: {color: text, boxWidth: 10, boxHeight: 10, usePointStyle: true, filter: (it, data) => !data.datasets[it.datasetIndex].noLegend}},
          tooltip: {backgroundColor: card, titleColor: fg, bodyColor: fg, borderColor: grid, borderWidth: 1, padding: 10,
            filter: (it) => !it.dataset.guide, callbacks: {title: (it) => it.length ? tipTime(it[0].parsed.x) : ""}},
        },
      },
    });
  }

  function resetCharts() { for (const [id, c] of Object.entries(charts)) { c.destroy(); delete charts[id]; } }
  function resizeCharts() { for (const c of Object.values(charts)) c.resize(); }
  const STEP_H = {6: 1, 24: 4, 72: 12};

  async function refreshChart() {
    let c;
    try { c = await api(`/api/chart?hours=${chartHours}`); }
    catch (e) { for (const id of ["priceChart", "equityChart"]) if (!charts[id]) chartState(id, "error", "Couldn't load the chart. Retrying shortly."); throw e; }
    const now = Date.now(), min = now - chartHours * 3600e3, stepH = STEP_H[chartHours] || 4;
    const sim = dataMode === "simulated", pre = sim ? "Simulated " : "";
    // a candle is plotted at its close time; the one still forming is plotted at "now" and drawn dashed
    const candles = c.candles.map((k) => ({x: Math.min(k.open_time + 15 * 60000, now), y: Number(k.close)}));
    const forming = c.candles.length > 0 && c.candles[c.candles.length - 1].open_time + 15 * 60000 > now;
    const line = withGaps(candles, 31 * 60000), last = line.length - 1;
    const mid = (rows) => rows.map((r) => ({x: r[0] * 1000, y: (Number(r[1]) + Number(r[2])) / 2}));
    const buys = c.fills.filter((f) => f.side === "buy").map((f) => ({x: f.ts * 1000, y: Number(f.avg_price)}));
    const sells = c.fills.filter((f) => f.side === "sell").map((f) => ({x: f.ts * 1000, y: Number(f.avg_price)}));
    const c1 = cssVar("--chart-1"), c2 = cssVar("--chart-2"), c3 = cssVar("--chart-3"), c4 = cssVar("--chart-4"), c5 = cssVar("--chart-5");
    lineChart("priceChart", [
      {label: `${pre}MEXC 15m close`, data: line, borderColor: c1, backgroundColor: c1, borderWidth: 1.8,
        pointRadius: (p) => forming && p.dataIndex === last ? 3 : 0,
        segment: {borderDash: (p) => forming && p.p1DataIndex === last ? [4, 4] : undefined}},
      {label: `${pre}MEXC mid`, data: mid(c.ticks.mexc || []), borderColor: c2, backgroundColor: c2, showLine: false, pointRadius: 1},
      {label: `${pre}Binance mid`, data: mid(c.ticks.binance || []), borderColor: c3, backgroundColor: c3, showLine: false, pointRadius: 1},
      {label: "Paper buy (fill)", data: buys, borderColor: c4, backgroundColor: c4, showLine: false, pointStyle: "triangle", pointRadius: 6},
      {label: "Paper sell (fill)", data: sells, borderColor: c5, backgroundColor: c5, showLine: false, pointStyle: "triangle", rotation: 180, pointRadius: 6},
    ], {yLabel: "USDT", min, max: now, stepH});
    $("priceNote").innerHTML = `${sim ? '<span class="badge mode-sim">SIMULATED</span> Prices come from the simulator, not an exchange. ' : ""}` +
      `Line: MEXC 15-minute candle closes${forming ? "; the dashed end is the candle still forming" : ""}. Dots: MEXC and Binance mid prices, last 6 hours. ` +
      `Triangles: paper fills (green buy, red sell), never real orders. Times are in your time zone${TZ ? ` (${esc(TZ)})` : ""}.`;
    // equity: break the line only for real outages (well beyond the usual spacing between samples), and start the
    // axis when the account's history starts instead of showing hours of empty chart before it
    const eq = (rows) => {
      const pts = rows.map((r) => ({x: r[0] * 1000, y: Number(r[1])}));
      const steps = pts.slice(1).map((p, i) => p.x - pts[i].x).sort((a, b) => a - b);
      return withGaps(pts, Math.max(15 * 60000, 4 * (steps[Math.floor(steps.length / 2)] || 0)));
    };
    const first = Math.min(...["total", "spot", "xarb"].map((k) => (c.equity[k] && c.equity[k].length ? c.equity[k][0][0] * 1000 : Infinity)));
    const eqMin = Number.isFinite(first) ? Math.max(min, first - 10 * 60000) : min;
    const eqSpanH = (now - eqMin) / 3600e3;
    const eqStep = eqSpanH <= 3 ? 0.5 : eqSpanH <= 8 ? 1 : eqSpanH <= 30 ? 4 : 12;
    lineChart("equityChart", [
      {label: "Total (A+B)", data: eq(c.equity.total || []), borderColor: c1, backgroundColor: c1, pointRadius: 0, borderWidth: 2.2},
      {label: "A spot", data: eq(c.equity.spot || []), borderColor: c4, backgroundColor: c4, pointRadius: 0, borderWidth: 1.2},
      {label: "B arbitrage", data: eq(c.equity.xarb || []), borderColor: c3, backgroundColor: c3, pointRadius: 0, borderWidth: 1.2},
    ], {yLabel: "USDT", min: eqMin, max: now, stepH: eqStep});
    $("equityNote").textContent = `${eqMin > min ? "Since this account's history starts" : `Last ${chartHours === 72 ? "3 days" : `${chartHours} hours`}`}, ` +
      `paper results only. Gaps mean the simulation wasn't running. Times are in your time zone${TZ ? ` (${TZ})` : ""}.`;
  }

  async function refreshArb() {
    let a;
    try { a = await api("/api/arb?minutes=240"); }
    catch (e) { if (!charts.arbChart) chartState("arbChart", "error", "Couldn't load the spread. Retrying shortly."); throw e; }
    const now = Date.now(), min = now - 240 * 60000, as = a.assumptions;
    const by = {};
    for (const r of a.series) (by[r.direction] = by[r.direction] || []).push({x: r.ts * 1000, y: Number(r.net_bps)});
    const colors = [cssVar("--chart-1"), cssVar("--chart-3")], muted = cssVar("--muted"), warn = cssVar("--chart-6");
    const flat = (y) => [{x: min, y}, {x: now, y}];
    lineChart("arbChart", [
      ...Object.entries(by).map(([k, v], i) => ({label: `${k} (net bps)`, data: withGaps(v, 120000), borderColor: colors[i % 2], backgroundColor: colors[i % 2], pointRadius: 0, borderWidth: 1.4})),
      {label: "zero", data: flat(0), borderColor: muted, borderWidth: 1, pointRadius: 0, guide: true, noLegend: true},
      {label: `Trade threshold (+${as.min_net_bps} bps net)`, data: flat(Number(as.min_net_bps)), borderColor: warn, backgroundColor: warn,
        borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0, guide: true},
    ], {yLabel: "net bps", min, max: now, stepH: 1});
    const sim = dataMode === "simulated";
    $("arbMode").innerHTML = sim ? '<span class="badge mode-sim">SIMULATED</span>' : '<span class="badge mode-live">LIVE PUBLIC DATA</span>';
    $("arbNote").textContent = `Net spread after fees, slippage and settlement, for each direction. Above the dashed line a paper trade can be placed. ` +
      `Times are in your time zone${TZ ? ` (${TZ})` : ""}.`;
    $("arbAssump").textContent = `Current settings: taker fee MEXC ${(as.taker_fee.mexc * 100).toFixed(3)} %, Binance ${(as.taker_fee.binance * 100).toFixed(3)} %; ` +
      `+${as.extra_slippage_bps} bps slippage per leg; ${as.rebalance_cost_bps} bps settlement; a trade needs at least ${as.min_net_bps} bps net.`;
    table($("arbLatest"), ["Direction", "Size BTC", "Gross bps", "Net bps", "Net USDT", "Executable", "Limited by / reason"],
      Object.values(a.latest).map((r) => [r.direction, num(r.qty, 6), num(r.gross_bps), H(signed(r.net_bps)), H(signed(r.net_usdt, 4)), r.executable ? "yes" : "no", W(r.reason)]),
      [1, 2, 3, 4], "No spread calculated yet");
  }

  async function refreshTrades() {
    const t = await api("/api/trades?limit=100");
    table($("tradesTable"), ["Opened", "Strategy", "Kind", "Status", "Buy venue", "Sell venue", "Qty BTC", "Entry", "Exit", "Fees+costs", "Net P/L USDT"],
      t.trades.map((r) => [time(r.ts_open), r.strategy, r.kind, r.status, r.venue_buy || "", r.venue_sell || "", num(r.qty, 6), num(r.entry_price), num(r.exit_price), num(r.fees, 4), H(r.net_pnl === null ? "open" : signed(r.net_pnl, 4))]),
      [6, 7, 8, 9, 10], "No paper trades yet");
    table($("rejections"), ["Time", "Strategy", "Reason"], t.rejections.map((r) => [time(r.ts), r.strategy, W(r.reason)]), [], "No rejected or failed orders");
  }

  let lastDecisions = [];
  function renderDecisions() {
    const fmt = (o) => Object.entries(o || {}).filter(([, v]) => v !== null && v !== "" && v !== undefined).map(([k, v]) => `${k}: ${typeof v === "string" && !isNaN(Number(v)) && v.length > 12 ? Number(v).toFixed(2) : v}`).join(", ");
    const fill = (id, values, all) => {
      const el = $(id), cur = el.value;
      el.innerHTML = `<option value="">${all}</option>` + values.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
    };
    const uniq = (k) => [...new Set(lastDecisions.map((r) => r[k]).filter(Boolean))].sort();
    fill("decStrategy", uniq("strategy"), "All strategies");
    fill("decType", uniq("type"), "All decisions");
    const fs = $("decStrategy").value, ft = $("decType").value;
    const rows = lastDecisions.filter((r) => (!fs || r.strategy === fs) && (!ft || r.type === ft));
    $("decCount").textContent = `${rows.length} of ${lastDecisions.length}`;
    table($("decisions"), ["Time", "Strategy", "Decision", "Price", "Details / reason"],
      rows.map((r) => {
        const text = fmt(r.detail);
        return [time(r.ts), r.strategy, r.type, num(r.price), text.length > 90
          ? {html: `<details><summary>${esc(text.slice(0, 80))}…</summary><p>${esc(text)}</p></details>`, wrap: true} : W(text)];
      }), [3], "No decisions match");
  }
  async function refreshDecisions() {
    lastDecisions = (await api("/api/decisions?limit=150")).decisions;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#decisions details")) return;
    renderDecisions();
  }
  document.addEventListener("change", (ev) => { if (ev.target.id === "decStrategy" || ev.target.id === "decType") renderDecisions(); });

  // alerts centre: warnings and errors from /api/state, filtered by severity
  let lastErrors = [], alertSev = "";
  function renderAlerts() {
    const rows = lastErrors.filter((e) => !alertSev || e.level === alertSev);
    $("errors").innerHTML = rows.length ? rows.map((e) => `<div class="alert-item" role="listitem">
        <span class="sev ${e.level === "error" ? "error" : "warning"}">${e.level === "error" ? "ERROR" : "WARNING"}</span>
        <div><div class="msg">${esc(e.message)}</div><div class="small muted">${esc(e.source)}</div></div>
        <time>${esc(time(e.ts))}</time></div>`).join("")
      : `<p class="muted">${lastErrors.length ? "Nothing at this severity." : "No warnings or errors recorded."}</p>`;
  }
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest ? ev.target.closest("#alertFilter button") : null;
    if (!b) return;
    alertSev = b.dataset.sev;
    document.querySelectorAll("#alertFilter button").forEach((x) => x.classList.toggle("on", x === b));
    renderAlerts();
  });

  async function refreshP2P() {
    const p = await api("/api/p2p");
    $("p2pStatus").textContent = `${p.status || "not started"} · MYR file: ${p.files.buy.present ? "uploaded " + time(p.files.buy.uploaded_at) : "missing"} · NGN file: ${p.files.sell.present ? "uploaded " + time(p.files.sell.uploaded_at) : "missing"}`;
    const rep = p.latest && p.latest.report;
    table($("p2pTable"), ["Size RM", "Verdict", "Net return %", "Net gain RM", "Implied NGN/MYR", "Benchmark", "Break-even sell", "Reasons"],
      rep ? rep.evaluations.map((e) => [num(e.size, 0), H(e.passed ? '<span class="good">PASS (check by hand)</span>' : '<span class="bad">REJECT</span>'),
        num(e.result.net_return_pct), num(e.result.net_gain_buy_fiat), num(e.result.implied_rate), num(e.result.benchmark_rate), num(e.result.break_even_sell_price), W(e.reasons.join("; "))]) : []);
  }

  async function refreshBacktest() {
    const b = await api("/api/backtest");
    const r = b.result;
    $("backtest").innerHTML = r.trades === undefined ? esc(r.note || "not enough candles yet") :
      `${r.candles} candles (${esc(r.source || "")}) · trades ${r.trades}, wins ${r.wins} · strategy ${signed(r.strategy_return_pct)} % vs buy &amp; hold ${signed(r.buy_hold_return_pct)} % · fees ${num(r.fees_usdt)} USDT per 1,000 USDT · rules: EMA${esc(b.rules.ema_fast)}/${esc(b.rules.ema_slow)} cross, RSI ${esc(b.rules.rsi_min)}–${esc(b.rules.rsi_max)}, stop ${esc(b.rules.stop_loss_pct)} %, target ${esc(b.rules.take_profit_pct)} %`;
  }

  const safe = (fn) => () => fn().catch((e) => console.warn(e));
  async function tick() { if (!role) return; try { renderState(await api("/api/state")); } catch (e) { $("worker").innerHTML = `<span class="bad">API error: ${esc(e.message)}</span>`; } }

  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (t.id === "estop" || t.id === "estop2") {
      const on = !(lastState && lastState.controls.emergency_stop);
      if (on || await ask("Paper trading resumes straight away: strategies can open and close simulated positions again.", {title: "Release the emergency stop?", ok: "Release and resume"})) {
        await api("/api/controls/emergency-stop", {method: "POST", body: JSON.stringify({on})}); tick();
      }
    }
    if (t.id === "riskReset") {
      if (await ask("Drawdown pauses are cleared and strategies may open new paper positions again.", {title: "Reset risk pauses?", ok: "Reset pauses"})) {
        await api("/api/controls/risk-reset", {method: "POST", body: "{}"}); tick();
      }
    }
    if (t.dataset && t.dataset.h) {
      chartHours = Number(t.dataset.h);
      document.querySelectorAll("#chartRange button").forEach((b) => b.classList.toggle("on", b === t));
      safe(refreshChart)();
    }
    if (t.id === "testTg" || t.id === "testMail") {
      const channel = t.id === "testTg" ? "telegram" : "email";
      if (!(await ask(`One real test message is sent via ${channel === "telegram" ? "Telegram" : "Gmail"}. Nothing else changes.`, {title: "Send a test message?", ok: "Send one test"}))) return;
      t.disabled = true; $("notifyMsg").textContent = "sending…";
      try { const r = await api("/api/notify/test", {method: "POST", body: JSON.stringify({channel, confirm: true})}); $("notifyMsg").textContent = (r.ok ? "✅ " : "❌ ") + r.detail; }
      catch (e) { $("notifyMsg").textContent = "❌ " + e.message; }
      t.disabled = false;
    }
  });
  document.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.strat) {
      await api(`/api/controls/strategy/${t.dataset.strat}`, {method: "POST", body: JSON.stringify({on: t.checked})}); tick();
    }
    if (t.id === "upBuy" || t.id === "upSell") {
      const file = t.files[0]; if (!file) return;
      $("upMsg").textContent = "uploading…";
      try {
        const r = await api("/api/p2p/upload", {method: "POST", body: JSON.stringify({leg: t.id === "upBuy" ? "buy" : "sell", content: await file.text()})});
        $("upMsg").textContent = `✅ ${r.ads} ads saved; evaluated within a minute`;
      } catch (e) { $("upMsg").textContent = "❌ " + e.message; }
      t.value = "";
    }
  });

  // --- approvals ----------------------------------------------------------------------------------
  const dl = (pairs) => `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const ACTIVE = new Set(["approved", "running"]);
  let approvalFilter = "pending", deepLink = null, lastApprovals = [];
  const STEPS = ["pending", "approved", "running", "completed"];

  function progress(a) {
    // Where a request is in its life: requested -> approved -> running -> completed (or how it ended).
    const end = {rejected: "Rejected", expired: "Expired", failed: "Failed"}[a.status];
    const at = STEPS.indexOf(a.status);
    const names = ["Requested", "Approved", "Running", "Completed"];
    return `<ol class="steps">${names.map((n, i) => {
      const cls = end ? (i === 0 || (a.status === "failed" && i < 3) ? "done" : "") : i < at ? "done" : i === at ? (a.status === "completed" ? "done" : "now") : "";
      return `<li class="${cls}">${n}</li>`;
    }).join("")}${end ? `<li class="end ${a.status}">${end}</li>` : ""}</ol>`;
  }

  function approvalCard(a) {
    return `<article class="approval ${a.status === "pending" ? "is-pending" : ""}" id="approval-${a.id}" aria-label="Request ${a.id}">
      <div class="approval-head"><span class="st ${esc(a.status)}">${esc(a.status.toUpperCase())}</span>
        <strong>#${a.id} ${esc(a.title)}</strong>
        ${a.destructive ? '<span class="badge" style="background:var(--bad);color:var(--on-status)">DESTRUCTIVE</span>' : ""}</div>
      ${progress(a)}
      <p class="impact"><strong>Impact:</strong> ${esc(a.impact)}</p>
      ${dl([["Action", `${a.action} ${JSON.stringify(a.params)}`], ["Target", a.target], ["Reason", a.reason],
            ["Risk", a.risk], ["Tests", a.tests], ["Rollback", a.rollback],
            ["Requested", `${time(a.created_at)} by ${a.requested_by}`], ["Expires", time(a.expires_at)],
            ...(a.decided_by ? [["Decision", `${a.status === "rejected" ? "rejected" : "approved"} by ${a.decided_by} at ${time(a.decided_at)}${a.decision_note ? " · " + a.decision_note : ""}`]] : []),
            ...(a.result ? [["Outcome", a.result.summary || JSON.stringify(a.result)]] : [])])}
      ${a.status === "pending" ? `<form class="approval-form" data-approval="${a.id}">
        <input type="password" name="password" autocomplete="current-password" placeholder="Password to confirm" aria-label="Password to confirm request ${a.id}" required>
        <input name="note" maxlength="1000" placeholder="Note (optional)" aria-label="Note for request ${a.id}">
        <div class="approval-buttons">
          <button class="btn primary" name="decision" value="approve" type="submit">Approve</button>
          <button class="btn" name="decision" value="reject" type="submit">Reject</button>
        </div>
        <span class="small" role="status"></span></form>` : ""}
    </article>`;
  }

  async function refreshApprovals() {
    const {approvals} = await api("/api/approvals?limit=50");
    if (deepLink && !approvals.some((a) => a.id === deepLink)) {
      try { approvals.unshift(await api(`/api/approvals/${deepLink}`)); } catch (_) { /* unknown id */ }
    }
    lastApprovals = approvals;
    const pending = approvals.filter((a) => a.status === "pending");
    updatePendingBadges(pending.length);
    $("approvalCount").textContent = pending.length ? `${pending.length} waiting` : "none waiting";
    // keep a half-typed password: don't redraw while a form field has focus
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest(".approval-form")) return;
    const shown = approvals.filter((a) => approvalFilter === "all" || a.status === "pending" || ACTIVE.has(a.status) || a.id === deepLink);
    $("approvals").innerHTML = shown.length ? shown.map(approvalCard).join("") :
      `<p class="muted">${approvals.length ? "Nothing waiting for you. Tap All to see earlier requests." : "No approval requests yet. The operations agent posts them here."}</p>`;
    if (deepLink) {
      const el = $(`approval-${deepLink}`);
      if (el) { el.classList.add("focus"); el.scrollIntoView({block: "start", behavior: "smooth"}); }
      deepLink = null;
    }
  }

  function updatePendingBadges(n) {
    $("navPending").textContent = n;
    $("navPending").classList.toggle("hidden", !n);
    $("pendingCallout").classList.toggle("hidden", !n);
    $("pendingCallout").textContent = n === 1 ? "1 operation is waiting for your approval →" : `${n} operations are waiting for your approval →`;
  }

  async function refreshAudit() {
    const r = await api("/api/audit?limit=60");
    $("auditChain").innerHTML = r.chain_ok ? '<span class="good">chain intact</span>' : '<span class="bad">chain check failed</span>';
    table($("auditTable"), ["Time", "Who", "Action", "Target", "IP"],
      r.entries.map((e) => [time(e.ts), e.actor, e.action, e.target, e.ip || ""]));
  }

  // --- operations, system and settings ------------------------------------------------------------
  const CHECKS = {health: "App health", resources: "Disk, memory, CPU", backup: "Nightly backup", backup_verify: "Backup verified",
    restore_test: "Restore test", updates: "Security updates", release_check: "New release tests", agent: "Operations agent",
    customers: "Customer accounts running", billing: "Billing records", offsite: "Off-site encrypted copy"};
  let lastOps = null;
  function checkRow(kind, r) {
    if (!r) return `<div class="check"><span class="dot"></span><div><strong>${esc(CHECKS[kind])}</strong><div class="small muted">no result yet</div></div></div>`;
    return `<div class="check"><span class="dot ${r.ok ? "ok" : "fail"}" aria-label="${r.ok ? "ok" : "failing"}"></span><div>
      <strong>${esc(CHECKS[kind] || kind)}</strong><div class="small">${esc(r.summary)}</div>
      <div class="small muted">${age(Date.now() / 1000 - r.ts)} ago</div></div></div>`;
  }
  function renderChecks(o, el, kinds) {
    el.innerHTML = kinds.map((k) => checkRow(k, o.latest[k])).join("");
  }
  async function refreshOps() {
    const o = lastOps = await api("/api/operations/status");
    const seen = o.agent_last_seen;
    const agentLine = seen === null ? '<span class="warn">operations agent has not reported yet</span>' :
      o.agent_stale ? `<span class="bad">operations agent silent for ${age(Date.now() / 1000 - seen)}</span>` : `<span class="good">agent ok · ${age(Date.now() / 1000 - seen)} ago</span>`;
    $("agentSeen").innerHTML = agentLine;
    renderChecks(o, $("checks"), Object.keys(CHECKS).filter((k) => k !== "offsite" || o.latest.offsite));   // shown once it's set up
    renderChecks(o, $("dashSystem"), ["health", "backup", "agent"]);
    const c = o.customers, b = o.billing, paid = b.paid_last_30d;
    $("customerMonitor").innerHTML = `<p class="small">${c.ok ? '<span class="good">●</span>' : '<span class="bad">●</span>'}
      ${esc(c.active)} customer account(s) running${c.last_pass_age_s !== null ? `, last pass ${age(c.last_pass_age_s)} ago` : ""}.
      ${c.problems.map((p) => `<br><span class="bad">${esc(p)}</span>`).join("")}</p>
      <p class="small">${b.ok ? '<span class="good">●</span>' : '<span class="bad">●</span>'} Billing: ${Object.entries(b.subscriptions)
        .map(([k, v]) => `${esc(v)} ${esc(k.replace("_", " "))}`).join(", ") || "no subscriptions"};
      ${esc(paid.count)} paid (${Object.entries(paid.by_currency || {}).map(([cur, v]) => money(v, cur)).join(" + ") || "nothing"}) and ${esc(b.failed_last_30d)} failed in the last 30 days.
      ${b.problems.map((p) => `<br><span class="bad">${esc(p)}</span>`).join("")}</p>`;
    table($("deployTable"), ["#", "Action", "Commit", "Status", "Requested", "Outcome"],
      o.deployments.map((a) => [H(`<a href="#approval-${a.id}">${a.id}</a>`), a.title, (a.params.commit || "").slice(0, 10),
        H(`<span class="st ${esc(a.status)}">${esc(a.status)}</span>`), time(a.created_at), W(a.result ? a.result.summary || "" : "")]));
    table($("backupTable"), ["Time", "Result", "Details"],
      o.backups.map((b) => [time(b.ts), H(b.ok ? '<span class="good">ok</span>' : '<span class="bad">failed</span>'), W(b.summary)]));
  }
  let mailInfo = null;
  async function refreshMailOutbox() {
    if (!mailInfo || !mailInfo.outbox_view) return;
    const r = await api("/api/admin/mail-outbox");
    $("mailOutboxCard").classList.remove("hidden");
    table($("mailOutbox"), ["Queued", "To", "Subject", "Message"], r.messages.map((m) => [time(m.ts), m.to_addr, m.subject,
      H(`<details><summary>Show</summary><p style="white-space:pre-wrap">${esc(m.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p></details>`)]),
      [], "No account emails yet");
  }
  async function refreshRuns() {
    const r = await api("/api/operations/runs?limit=60");
    table($("runsTable"), ["Time", "Check", "Result", "Summary"],
      r.runs.map((x) => [time(x.ts), CHECKS[x.kind] || x.kind, H(x.ok ? '<span class="good">ok</span>' : '<span class="bad">failing</span>'), W(x.summary)]));
  }
  async function refreshSessions() {
    const r = await api("/api/sessions");
    table($("sessionsTable"), ["Device", "IP", "Signed in", "Last active", ""],
      r.sessions.map((x) => [H(`<span title="${esc(x.user_agent || "")}">${esc(uaName(x.user_agent))}</span>`), x.ip || "", time(x.created_at), time(x.last_seen),
        x.id === r.current ? H('<span class="badge">this device</span>') : ""]));
  }

  // --- risk limits form -----------------------------------------------------------------------------
  const LIMIT_LABELS = {max_position_pct: "Max position, % of allocation", daily_loss_limit_pct: "Daily loss limit, %",
    max_drawdown_pct: "Max drawdown, %", max_btc_exposure_pct: "Max BTC exposure, % of equity"};
  const SCOPE_LABELS = {spot: LABELS.spot, xarb: LABELS.xarb, global: "All strategies together"};
  async function refreshLimits() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#limitsForms")) return;
    const l = await api("/api/settings/limits");
    $("limitsForms").innerHTML = ["spot", "xarb", "global"].map((scope) => {
      const b = l.bounds[scope === "global" ? "global" : "strategy"];
      const ov = l.overrides[scope] || {};
      return `<form class="limits" data-scope="${scope}"><h3>${esc(SCOPE_LABELS[scope])}</h3>
        ${Object.keys(b).map((k) => `<label>${esc(LIMIT_LABELS[k])}
          <input name="${k}" type="number" inputmode="decimal" step="0.1" min="${b[k][0]}" max="${b[k][1]}" value="${esc(l.effective[scope][k])}">
          <span class="small muted">default ${esc(l.defaults[scope][k])} · allowed ${b[k][0]}–${b[k][1]}${ov[k] !== undefined ? " · <b>changed</b>" : ""}</span></label>`).join("")}
        <div class="row"><button class="btn primary" type="submit">Save</button>
          <button class="btn" type="button" data-reset-limits="${scope}">Use defaults</button></div>
        <span class="small" role="status"></span></form>`;
    }).join("");
  }
  async function saveLimits(form, values) {
    const status = form.querySelector("[role=status]");
    try {
      await api("/api/settings/limits", {method: "POST", body: JSON.stringify({scope: form.dataset.scope, values})});
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      await refreshLimits(); tick();
      const f = document.querySelector(`#limitsForms form[data-scope="${form.dataset.scope}"] [role=status]`);
      if (f) f.textContent = "✅ Saved. Applies on the next tick.";
    } catch (e) { status.textContent = "❌ " + e.message; }
  }

  // --- forms and buttons ----------------------------------------------------------------------------
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (f.dataset && f.dataset.scope) {
      ev.preventDefault();
      const values = {};
      for (const input of f.querySelectorAll("input")) values[input.name] = input.value === "" ? null : Number(input.value);
      if (!(await ask("The new limits apply on the next tick and are recorded in the audit trail.", {title: `Change ${SCOPE_LABELS[f.dataset.scope]} risk limits?`, ok: "Save limits"}))) return;
      await saveLimits(f, values);
      return;
    }
    if (!f.dataset || !f.dataset.approval) return;
    ev.preventDefault();
    const approve = ev.submitter && ev.submitter.value === "approve";
    const status = f.querySelector("[role=status]");
    if (!f.password.value) { status.textContent = "Enter your password to confirm."; return; }
    if (!(await ask(approve ? "The server agent may run this request once it is approved." : "The request is closed and will not run.", {title: `${approve ? "Approve" : "Reject"} request #${f.dataset.approval}?`, ok: approve ? "Approve" : "Reject", danger: !approve}))) { f.password.value = ""; return; }
    f.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    status.textContent = approve ? "Approving…" : "Rejecting…";
    try {
      await api(`/api/approvals/${f.dataset.approval}/decision`, {method: "POST",
        body: JSON.stringify({approve, password: f.password.value, note: f.note.value})});
      f.password.value = "";
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      await safe(refreshApprovals)(); safe(refreshAudit)();
    } catch (e) { status.textContent = "❌ " + e.message; f.querySelectorAll("button").forEach((b) => { b.disabled = false; }); f.password.value = ""; }
  });
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest ? ev.target.closest("button") : null;
    if (!t) return;
    if (t.dataset.resetLimits) {
      const form = t.closest("form");
      if (!(await ask("Your changes to these limits are removed and the server defaults apply on the next tick.", {title: `Use default limits for ${SCOPE_LABELS[t.dataset.resetLimits]}?`, ok: "Use defaults"}))) return;
      const values = {};
      for (const input of form.querySelectorAll("input")) values[input.name] = null;
      await saveLimits(form, values);
    }
    if (t.dataset.f) {
      approvalFilter = t.dataset.f;
      document.querySelectorAll("#approvalFilter button").forEach((b) => b.classList.toggle("on", b === t));
      safe(refreshApprovals)();
    }
    if (t.id === "logout") {
      try { await api("/api/session/logout", {method: "POST", body: "{}"}); } catch (_) { /* already signed out */ }
      location.replace("./");
    }
    if (t.id === "resendVerify") {
      t.disabled = true;
      try {
        const r = await api("/api/account/verify-email/send", {method: "POST", body: "{}"});
        $("verifyMsg").textContent = r.already_verified ? "Already confirmed." : "Sent. Check your inbox and spam folder.";
        if (r.already_verified) safe(refreshAccount)();
      } catch (e) { $("verifyMsg").textContent = e.message; }
      t.disabled = false;
    }
    if (t.id === "logoutAll") {
      if (!(await ask("Every signed-in device is signed out, including this one.", {title: "Sign out everywhere?", ok: "Sign out everywhere", danger: true}))) return;
      try { await api("/api/sessions/revoke-all", {method: "POST", body: "{}"}); } catch (_) { /* signed out anyway */ }
      location.replace("./");
    }
  });

  // --- accounts -----------------------------------------------------------------------------------
  async function refreshAccount() {
    const me = await api("/api/account");
    $("roleBadge").textContent = me.role.toUpperCase();
    $("accountLine").textContent = me.account ? `Signed in as ${me.account.email}${me.account.display_name ? " (" + me.account.display_name + ")" : ""}.`
      : `Signed in as ${me.user}, the owner. The owner password is set on the server.`;
    $("welcomeName").textContent = me.account && me.account.display_name ? `, ${me.account.display_name}` : "";
    $("sideUser").textContent = me.account ? me.account.email : `${me.user} (owner)`;
    const unverified = !!(me.account && !me.account.email_verified);
    $("verifyBanner").classList.toggle("hidden", !unverified);
    $("verifyAddr").textContent = me.account ? me.account.email : "";
    if (me.account) $("accountLine").textContent += me.account.email_verified ? " Email confirmed." : " Email not confirmed yet.";
    mailInfo = me.mail;
    $("sidePlan").textContent = me.role === "customer" ? "Paper trading only" : `${me.role === "owner" ? "Owner" : "Admin"} · paper trading only`;
    if (me.role === "customer") await renderPlan(me);
  }

  // --- plans --------------------------------------------------------------------------------------
  const SYMBOL = {USD: "US$", MYR: "RM"};
  const money = (minor, cur) => (SYMBOL[cur] || `${cur} `) + (minor / 100).toLocaleString("en-US", {minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2});
  const day = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "–";
  const STATUS_TEXT = {trialing: "TRIAL", active: "ACTIVE", past_due: "PAYMENT DUE", cancelled: "CANCELLED", expired: "ENDED"};
  let catalogue = null;
  function featureText(key, v) {
    const f = catalogue.features[key];
    if (f.type === "bool") return {on: !!v, text: f.label};
    if (key === "max_starting_balance_myr") return {on: v > 0, text: `Virtual starting balance up to RM${Number(v).toLocaleString()}`};
    if (key === "history_days") return {on: v > 0, text: `${v} days of trade and chart history`};
    if (key === "resets_per_month") return {on: v > 0, text: `${v} account restart${v === 1 ? "" : "s"} per 30 days`};
    return {on: v > 0, text: `${f.label}: ${v}`};
  }
  const planName = (code) => ((catalogue && catalogue.plans.find((x) => x.code === code)) || {name: code}).name;
  const featureList = (features) => Object.keys(catalogue.features).map((k) => featureText(k, features[k]))
    .map((f) => `<li class="${f.on ? "" : "off"}">${esc(f.text)}</li>`).join("");
  async function renderPlan(me) {
    catalogue = await api("/api/plans");
    const bill = await api("/api/billing");
    ent = me.entitlements;
    const sub = me.subscription;
    const plan = sub && catalogue.plans.find((x) => x.code === sub.plan_code);
    $("planStatus").textContent = sub ? STATUS_TEXT[sub.status] || sub.status.toUpperCase() : "NO PLAN";
    $("planLine").textContent = !sub ? "You don't have a plan yet." :
      `${plan ? plan.name : sub.plan_code}${sub.status === "trialing" ? " free trial" : ""}. ` +
      (ent.active ? (sub.status === "past_due" ? `Payment failed. Access continues until ${day(sub.grace_until)}.`
        : sub.cancel_at_period_end || sub.status === "cancelled" ? `Ends on ${day(sub.current_period_end)}.`
        : sub.status === "trialing" ? `Trial ends on ${day(sub.current_period_end)}.`
        : sub.provider === "manual" ? `Given by support until ${day(sub.current_period_end)}.` : `Renews on ${day(sub.current_period_end)}.`)
        : `Ended on ${day(sub.current_period_end)}. Your simulated account is paused until you choose a plan.`);
    $("planFeatures").innerHTML = ent.active ? featureList(ent.features) : "";
    const trial = sub && sub.status === "trialing" && ent.active;
    const left = trial ? Math.max(0, Math.ceil((sub.current_period_end - Date.now() / 1000) / 86400)) : 0;
    $("trialBanner").classList.toggle("hidden", !trial);
    $("trialBanner").innerHTML = trial ? `<div><strong>${left} day${left === 1 ? "" : "s"} left in your free trial</strong>
      <div class="small muted">Trial ends on ${esc(day(sub.current_period_end))}. Nothing is charged unless you choose a plan.</div></div>` : "";
    $("sidePlan").textContent = sub ? `${plan ? plan.name : sub.plan_code} · ${(STATUS_TEXT[sub.status] || sub.status).toLowerCase()}` : "No plan";
    const paid = sub && !["trial", "manual"].includes(sub.provider) && ["active", "past_due"].includes(sub.status);
    const current = (x) => plan && x.code === plan.code && ent.active && paid;
    $("planChoices").innerHTML = catalogue.plans.map((x) => `<div class="plan${current(x) ? " current" : ""}">
      <h4>${esc(x.name)}${current(x) ? '<span class="badge">CURRENT</span>' : ""}</h4>
      <div class="price">${money(x.monthly_sen, x.currency)}<small>/month</small></div>
      <div class="muted small">or ${money(x.annual_sen, x.currency)}/year</div>
      <ul class="feature-list small">${featureList(x.features)}</ul>
      ${bill.enabled && !bill.paused && !current(x) && !(paid && sub.provider === "stripe") ? `<div class="row">
        <button class="btn primary small" type="button" data-checkout="${esc(x.code)}" data-interval="month">Choose monthly</button>
        <button class="btn small" type="button" data-checkout="${esc(x.code)}" data-interval="year">Choose annual</button></div>` : ""}
      </div>`).join("") +
      (paid && sub.provider === "stripe" ? '<p class="muted small">To switch plan, cancel at the end of this period and choose the new plan when it ends, or ask support.</p>' : "") +
      (bill.paused ? '<p class="small bad">Online payment is paused while prices move to a new currency.</p>' : "") +
      (bill.enabled ? (bill.test_mode ? (bill.provider === "stripe"
          ? '<p class="muted small"><span class="badge test">TEST MODE</span> Payment uses Stripe test mode. Only Stripe test cards work and nothing is charged.</p>'
          : '<p class="muted small"><span class="badge test">TEST MODE</span> Checkout is simulated and nothing is charged.</p>') : "")
        : '<p class="muted small">Online payment is not switched on yet. Contact support to change plan.</p>');
    $("planActions").innerHTML = (paid ? (sub.cancel_at_period_end
      ? '<button class="btn" type="button" data-cancel="0">Keep my plan</button>'
      : '<button class="btn danger" type="button" data-cancel="1">Cancel at end of period</button>') : "") +
      (bill.portal ? '<button class="btn" type="button" data-portal="1">Manage billing (card, invoices)</button>' : "");
    if (new URLSearchParams(location.search).get("checkout") === "done" && !paid)
      $("planLine").textContent = "Payment received by Stripe. Your plan switches on as soon as Stripe confirms it, usually within a minute.";
    table($("invoicesTable"), ["Date", "Plan", "Amount", "Status", "Period"], (bill.invoices || []).map((i) => [day(i.created_at),
      `${planName(i.plan_code)} (${i.interval === "year" ? "annual" : "monthly"})`, money(i.amount_sen, i.currency),
      H(i.status === "paid" ? '<span class="good">paid</span>' : `<span class="bad">${esc(i.status)}</span>`),
      i.period_start ? `${day(i.period_start)} to ${day(i.period_end)}` : "–"]));
    const banner = $("planBanner"), due = ent.active && sub && sub.status === "past_due";
    banner.classList.toggle("hidden", ent.active && !due);
    banner.innerHTML = due ? `Your last payment failed. The payment will be retried; your plan stays active until ${esc(day(sub.grace_until))}. <a href="#settings">Billing</a>`
      : ent.active ? "" : 'Your plan has ended, so your simulated account is paused. <a href="#settings">See plans</a>';
  }
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest ? ev.target.closest("button[data-checkout], button[data-cancel], button[data-portal]") : null;
    if (!b) return;
    try {
      if (b.dataset.portal) {
        location.assign((await api("/api/billing/portal", {method: "POST"})).url);
      } else if (b.dataset.checkout) {
        const r = await api("/api/billing/checkout", {method: "POST", body: JSON.stringify({plan: b.dataset.checkout, interval: b.dataset.interval})});
        location.assign(r.url);
      } else {
        const cancel = b.dataset.cancel === "1";
        if (cancel && !(await ask("You keep your plan until the end of the period you've paid for, then your simulated account pauses.", {title: "Cancel your plan?", ok: "Cancel at end of period", cancel: "Keep my plan", danger: true}))) return;
        await api("/api/billing/cancel", {method: "POST", body: JSON.stringify({cancel})});
        safe(refreshAccount)();
      }
    } catch (e) { tell(e.message); }
  });
  const plansDirty = new Set();                     // don't wipe an admin's unsaved edits on the 30 s refresh
  async function refreshPlans() {
    if (!isStaff() || plansDirty.size) return;
    catalogue = await api("/api/plans");
    const {plans, currency, migration} = await api("/api/admin/plans");
    $("plansCurrency").textContent = currency.mismatch.length
      ? `Billing currency is set to ${currency.configured}, but these prices are stored in another currency, so checkout is paused. ` +
        `Converting them needs the owner's approval (preview: ${migration.changes.map((c) => `${c.plan} ${money(c.from[1], c.from[0])} → ${money(c.to[1], c.to[0])}/month`).join(", ")}` +
        `${migration.blockers.length ? "; blocked: " + migration.blockers.join("; ") : ""}).`
      : `Prices are in ${currency.configured}.`;
    $("plansCurrency").classList.toggle("bad", !!currency.mismatch.length);
    $("plansEditor").innerHTML = plans.map((x) => `<form class="plan plan-edit" data-plan="${esc(x.code)}">
      <h4>${esc(x.code)}<label class="check"><input type="checkbox" name="active" ${x.active ? "checked" : ""}> on sale</label></h4>
      <label>Name<input type="text" name="name" value="${esc(x.name)}" maxlength="40" required></label>
      <label>Monthly price (${esc(SYMBOL[x.currency] || x.currency)})<input type="number" name="monthly" value="${x.monthly_sen / 100}" min="1" max="${x.currency === "MYR" ? 100000 : 10000}" step="0.01" inputmode="decimal" required></label>
      <label>Annual price (${esc(SYMBOL[x.currency] || x.currency)})<input type="number" name="annual" value="${x.annual_sen / 100}" min="1" max="${x.currency === "MYR" ? 100000 : 10000}" step="0.01" inputmode="decimal" required></label>
      ${Object.entries(catalogue.features).map(([k, f]) => f.type === "bool"
        ? `<label class="check"><input type="checkbox" name="f_${k}" ${x.features[k] ? "checked" : ""}> ${esc(f.label)}</label>`
        : `<label>${esc(f.label)}<input type="number" name="f_${k}" value="${esc(x.features[k])}" min="${f.min}" max="${f.max}" step="1" required></label>`).join("")}
      <div class="row"><button class="btn primary" type="submit">Save ${esc(x.name)}</button><span class="small" role="status"></span></div>
    </form>`).join("");
  }
  $("plansEditor").addEventListener("input", (ev) => {
    plansDirty.add(ev.target.form.dataset.plan); $("plansMsg").textContent = "Unsaved changes";
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (!f.dataset || !f.dataset.plan) return;
    ev.preventDefault();
    const status = f.querySelector("[role=status]");
    const features = {};
    for (const [k, def] of Object.entries(catalogue.features)) {
      const input = f.elements[`f_${k}`];
      features[k] = def.type === "bool" ? input.checked : Number(input.value);
    }
    const body = {name: f.elements.name.value.trim(), active: f.elements.active.checked, features,
      monthly_sen: Math.round(Number(f.monthly.value) * 100), annual_sen: Math.round(Number(f.annual.value) * 100)};
    if (!(await ask("New prices apply to new subscriptions and renewals.", {title: `Save ${body.name}?`, ok: "Save plan"}))) return;
    try { await api(`/api/admin/plans/${encodeURIComponent(f.dataset.plan)}`, {method: "POST", body: JSON.stringify(body)});
      status.textContent = "✅ Saved"; plansDirty.delete(f.dataset.plan);
      $("plansMsg").textContent = plansDirty.size ? "Unsaved changes" : ""; }
    catch (e) { status.textContent = "❌ " + e.message; }
  });
  async function refreshAccounts() {
    if (!isStaff()) return;
    const picking = document.activeElement;
    if (picking && picking.tagName === "SELECT" && $("accountsTable").contains(picking)) return;   // an admin is choosing a plan
    const {accounts} = await api("/api/admin/accounts");
    $("accountCount").textContent = `${accounts.length} account${accounts.length === 1 ? "" : "s"}`;
    if (!catalogue) catalogue = await api("/api/plans");
    table($("accountsTable"), ["Email", "Role", "Status", "Plan", "Created", ""], accounts.map((a) => [W(a.email), a.role,
      a.status === "active" && a.role === "customer" && !a.email_verified ? "active · email not confirmed" : a.status,
      a.role !== "customer" ? "–" : a.plan ? W(`${planName(a.plan.code)} · ${(STATUS_TEXT[a.plan.status] || a.plan.status).toLowerCase()} · until ${day(a.plan.current_period_end)}`) : "none",
      time(a.created_at),
      a.status === "deleted" ? "deleted by the customer" : H(`${a.status === "active" ? `<button class="btn small" type="button" data-acct="${a.id}" data-set="status:disabled">Disable</button>`
          : `<button class="btn small" type="button" data-acct="${a.id}" data-set="status:active">Enable</button>`}
        ${role === "owner" ? (a.role === "admin" ? `<button class="btn small" type="button" data-acct="${a.id}" data-set="role:customer">Make customer</button>`
          : `<button class="btn small" type="button" data-acct="${a.id}" data-set="role:admin">Make admin</button>`) : ""}
        ${a.role === "customer" ? `<span class="grant"><select aria-label="Plan for ${esc(a.email)}" data-grant-plan="${a.id}">${catalogue.plans.map((x) =>
          `<option value="${esc(x.code)}" ${a.plan && a.plan.code === x.code ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
          <button class="btn small" type="button" data-grant="${a.id}">Give 30 days</button></span>
          <button class="btn small" type="button" data-restore="${a.id}" data-email="${esc(a.email)}">Restore…</button>` : ""}`)]));
  }
  document.addEventListener("click", async (ev) => {
    const r = ev.target.closest ? ev.target.closest("button[data-restore]") : null;
    if (!r) return;
    const ops = lastOps || await api("/api/operations/status");
    const names = ops.backups.filter((x) => x.ok && x.detail && x.detail.tenants).map((x) => x.detail.tenants);
    if (!names.length) { tell("No verified customer backup yet. The nightly backup makes one.", "Nothing to restore yet"); return; }
    const backup = prompt(`Restore ${r.dataset.email}'s simulated account from which backup?\n${names.join("\n")}`, names[0]);
    if (!backup) return;
    const reason = prompt("Reason (shown on the approval request):", "Customer asked to undo recent changes");
    if (!reason) return;
    try {
      const a = await api(`/api/admin/accounts/${r.dataset.restore}/restore`, {method: "POST", body: JSON.stringify({backup: backup.trim(), reason})});
      location.hash = `#approval-${a.id}`;
    } catch (e) { tell(e.message); }
  });
  document.addEventListener("click", async (ev) => {
    const g = ev.target.closest ? ev.target.closest("button[data-grant]") : null;
    if (!g) return;
    const plan = document.querySelector(`select[data-grant-plan="${g.dataset.grant}"]`).value;
    if (!(await ask("No payment is taken. This is recorded in the audit log.", {title: `Give this customer 30 days of ${plan}?`, ok: "Give 30 days"}))) return;
    try { await api(`/api/admin/accounts/${g.dataset.grant}/plan`, {method: "POST", body: JSON.stringify({plan, days: 30})}); }
    catch (e) { tell(e.message); }
    safe(refreshAccounts)();
  });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest ? ev.target.closest("button[data-acct]") : null;
    if (!b) return;
    const [field, value] = b.dataset.set.split(":");
    if (!(await ask("This is recorded in the audit log.", {title: `${b.textContent.trim()} this account?`, ok: b.textContent.trim(), danger: value === "disabled"}))) return;
    try { await api(`/api/admin/accounts/${b.dataset.acct}`, {method: "POST", body: JSON.stringify({[field]: value})}); }
    catch (e) { tell(e.message); }
    safe(refreshAccounts)();
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (f.id === "resetForm") {
      ev.preventDefault();
      const status = f.querySelector("[role=status]");
      if (!(await ask(`Your simulated account is archived and a new one starts with RM${Number(f.balance.value).toLocaleString()}. Your trade history starts empty.`, {title: "Start over?", ok: "Archive and start over", danger: true}))) { f.password.value = ""; return; }
      try {
        const r = await api("/api/account/reset", {method: "POST", body: JSON.stringify({password: f.password.value, starting_balance_myr: Number(f.balance.value)})});
        status.textContent = "✅ " + r.detail;
      } catch (e) { status.textContent = "❌ " + e.message; }
      finally { f.password.value = ""; }
      return;
    }
    if (f.id === "deleteForm") {
      ev.preventDefault();
      const status = f.querySelector("[role=status]");
      status.textContent = "";
      if (f.confirm.value.trim().toUpperCase() !== "DELETE") { status.textContent = "Type DELETE to confirm."; return; }
      if (!(await ask("Your sign-in, email and name are removed now and you're signed out everywhere. Your simulated history is deleted after 30 days. This can't be undone from the app.",
        {title: "Delete your account?", ok: "Delete my account", danger: true}))) { f.password.value = ""; return; }
      try {
        await api("/api/account/delete", {method: "POST", body: JSON.stringify({password: f.password.value, confirm: f.confirm.value})});
        location.replace("/welcome");
      } catch (e) { status.textContent = "❌ " + e.message; }
      finally { f.password.value = ""; }
      return;
    }
    if (f.id !== "pwForm" && f.id !== "newAccountForm") return;
    ev.preventDefault();
    const status = f.querySelector("[role=status]");
    status.textContent = "";
    try {
      if (f.id === "pwForm") {
        const r = await api("/api/account/password", {method: "POST", body: JSON.stringify({current: f.current.value, new: f.new.value})});
        csrf = r.csrf;
        status.textContent = "✅ Password changed. Your other devices were signed out.";
      } else {
        await api("/api/admin/accounts", {method: "POST", body: JSON.stringify({email: f.email.value.trim(), password: f.password.value, role: f.role.value})});
        status.textContent = "✅ Account added. Share the temporary password privately.";
        f.email.value = "";
        safe(refreshAccounts)();
      }
    } catch (e) { status.textContent = "❌ " + e.message; }
    finally { f.querySelectorAll("input[type=password]").forEach((i) => { i.value = ""; }); }
  });

  // --- appearance ---------------------------------------------------------------------------------
  const ACCENT_NAMES = {ocean: "Ocean Blue", emerald: "Emerald", violet: "Violet", sunset: "Sunset", rose: "Rose", mono: "Monochrome"};
  function renderAppearance() {
    const root = document.documentElement;
    $("modeSeg").innerHTML = window.ptTheme.MODES.map((m) =>
      `<button type="button" data-mode="${m}" class="${root.dataset.mode === m ? "on" : ""}" aria-pressed="${root.dataset.mode === m}"><span class="pv ${m}" aria-hidden="true"></span>${m[0].toUpperCase() + m.slice(1)}</button>`).join("");
    $("accentSwatches").innerHTML = window.ptTheme.ACCENTS.map((a) =>
      `<button type="button" class="swatch" data-accent="${a}" aria-pressed="${root.dataset.accent === a}"><span class="dot ${a}" aria-hidden="true"></span>${ACCENT_NAMES[a]}</button>`).join("");
  }
  async function loadPreferences() {
    const p = await api("/api/preferences");
    window.ptTheme.apply(p);               // the server copy wins over this browser's copy
    renderAppearance();
  }
  async function savePreference(change) {
    const root = document.documentElement;
    window.ptTheme.apply({mode: change.mode || root.dataset.mode, accent: change.accent || root.dataset.accent});
    renderAppearance(); resetCharts(); loadView();
    try { await api("/api/preferences", {method: "POST", body: JSON.stringify(change)}); $("appearanceMsg").textContent = "Saved to your account."; }
    catch (e) { $("appearanceMsg").textContent = "❌ Not saved: " + e.message; }
  }
  document.addEventListener("click", (ev) => {
    const j = ev.target.closest ? ev.target.closest("button[data-jump]") : null;
    if (j) { $(j.dataset.jump).scrollIntoView({block: "start", behavior: "smooth"}); return; }
    const b = ev.target.closest ? ev.target.closest("#modeSeg button, #accentSwatches button") : null;
    if (!b) return;
    savePreference(b.dataset.mode ? {mode: b.dataset.mode} : {accent: b.dataset.accent});
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { resetCharts(); if (view) loadView(); });

  // --- views ----------------------------------------------------------------------------------------
  // Each view refreshes only its own data while it is on screen; the header state ticks everywhere.
  const VIEWS = {
    dashboard: {every: 10000, load: [refreshChart, refreshOps]},
    markets: {every: 10000, load: [refreshChart, refreshArb, refreshP2P]},
    strategies: {every: 15000, load: [refreshLimits, refreshBacktest]},
    trades: {every: 10000, load: [refreshTrades, refreshDecisions]},
    operations: {every: 15000, fast: 4000, load: [refreshApprovals, refreshOps, refreshAudit]},
    alerts: {every: 30000, load: []},
    system: {every: 30000, load: [refreshOps, refreshRuns, refreshMailOutbox]},
    settings: {every: 30000, load: [refreshSessions, refreshAccount, refreshAccounts, refreshPlans]},
    more: {every: 60000, load: []},
  };
  let view = null, viewTimer = null;

  const CUSTOMER_VIEWS = new Set(["dashboard", "markets", "strategies", "trades", "alerts", "settings", "more"]);
  // house-only data: operations, the P2P monitor, other users
  const STAFF_LOADERS = new Set([refreshOps, refreshRuns, refreshApprovals, refreshAudit, refreshAccounts, refreshPlans, refreshP2P, refreshMailOutbox]);
  function loadView() {
    const v = VIEWS[view];
    const loaders = isStaff() ? v.load : v.load.filter((fn) => !STAFF_LOADERS.has(fn));
    loaders.forEach((fn) => safe(fn)());
    if (!isStaff() && view === "dashboard") safe(refreshAccount)();
    clearTimeout(viewTimer);
    // while an approved request is running, poll faster so "completed" shows up promptly
    const busy = view === "operations" && lastApprovals.some((a) => ACTIVE.has(a.status));
    viewTimer = setTimeout(loadView, busy ? v.fast : v.every);
  }

  function route() {
    let name = (location.hash || "#dashboard").slice(1);
    const m = /^approval-(\d+)$/.exec(name);
    if (m) { deepLink = Number(m[1]); approvalFilter = "all"; name = "operations";
      document.querySelectorAll("#approvalFilter button").forEach((b) => b.classList.toggle("on", b.dataset.f === "all")); }
    if (!VIEWS[name] || (!isStaff() && !CUSTOMER_VIEWS.has(name))) {
      name = "dashboard";
      if (role && location.hash && location.hash !== "#dashboard") history.replaceState(null, "", "#dashboard");
    }
    view = name;
    document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== `view-${name}`; });
    document.querySelectorAll(".tabs a").forEach((a) => {
      const on = a.dataset.view === name || (a.dataset.view === "more" && ["strategies", "alerts", "system", "settings", "more"].includes(name));
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("viewTitle").textContent = $(`view-${name}`).dataset.title;
    document.title = `${$(`view-${name}`).dataset.title} · Paper Trader`;
    if (!m) window.scrollTo(0, 0);
    loadView();
    requestAnimationFrame(resizeCharts);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => { setOffline(false); tick(); loadView(); });
  window.addEventListener("offline", () => setOffline(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && view) { tick(); loadView(); } });

  window.addEventListener("load", async () => {
    if ("serviceWorker" in navigator) Promise.resolve().catch(() => { /* optional */ });
    try { const s = await api("/api/session"); csrf = s.csrf; role = s.role; } catch (_) { return; }
    document.body.dataset.role = role;
    await safe(refreshAccount)();   // entitlements before the first strategy cards render
    await tick();                   // the data mode labels the charts, so read it first
    route(); safe(loadPreferences)();
    setInterval(tick, 3000);
    if (!isStaff()) return;                 // the approvals badge is for staff
    // pending count for the tab badge, whichever view is open
    safe(refreshApprovals)();
    setInterval(() => { if (view !== "operations") safe(async () => {
      const {approvals} = await api("/api/approvals?status=pending&limit=50"); updatePendingBadges(approvals.length);
    })(); }, 30000);
  });
})();
