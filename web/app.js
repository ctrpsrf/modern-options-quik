// Modern Option Trader QUIK — основное приложение: фид, доска опционов, тикет, позиции/заявки
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('motq.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('motq.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

function fmt(v, dec = 0, sign = false) {
  if (v == null || !isFinite(v)) return '—';
  const s = Number(v).toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return sign && v > 0 ? '+' + s : s;
}
const pct = (v, d = 1) => v == null ? '—' : (v * 100).toFixed(d);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clsPL = v => v > 0 ? 'g' : v < 0 ? 'r' : '';
const mid = q => q && q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : null;
const fmtDate = e => { const [y, m, d] = e.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtExp = e => { const [, m, d] = e.split('-'); return `${+d} ${MONTHS[+m - 1]}`; };

const App = {
  snap: null, mode: null, autoDemo: false, age: null, base: store.get('base', null), expiry: null,
  ticket: null, tab: 'pos', view: 'chain', M: null, seenEv: new Set(), lastSub: 0, scrolledFor: null,
};

/* ============================ FEED ============================ */
function startFeed() {
  if (location.protocol === 'file:') return startDemo(true);
  let got = false;
  const es = new EventSource('/api/stream');
  es.addEventListener('meta', e => { App.age = JSON.parse(e.data).age; renderStatus(); });
  es.onmessage = e => {
    const s = JSON.parse(e.data);
    got = true;
    const fresh = App.age != null && App.age >= 0 && App.age < 5;
    if (App.mode === 'demo') {
      if (App.autoDemo && fresh) { stopDemo(); App.mode = 'live'; toast('Подключено к QUIK', 'ok'); } else return;
    }
    App.mode = 'live';
    onSnap(s);
  };
  es.onerror = () => { App.age = null; renderStatus(); };
  setTimeout(() => { if (!got || !(App.age >= 0 && App.age < 5)) startDemo(true); }, 2500);
}
let demoTimer = null;
function startDemo(auto) {
  if (App.mode === 'demo') return;
  App.mode = 'demo'; App.autoDemo = !!auto;
  if (auto) toast('QUIK не отвечает — включён демо-режим. Запустите quik_bridge.lua в QUIK.', 'info');
  const tick = () => onSnap(Demo.snapshot());
  tick(); demoTimer = setInterval(tick, 1000);
  renderStatus();
}
function stopDemo() { clearInterval(demoTimer); demoTimer = null; App.snap = null; App.M = null; }

async function send(cmd, args = []) {
  if (App.mode === 'demo') { Demo.command(cmd, args.map(String)); return true; }
  try {
    const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, args }) });
    if (!r.ok) throw new Error(r.status);
    return true;
  } catch (e) { toast('Сервер недоступен: ' + e.message, 'err'); return false; }
}

/* ============================ MODEL ============================ */
function enrich(o, F, now) {
  const T = BS.yearsTo(o.e, now), isC = o.t === 'C';
  const mk = o.theor ?? mid(o) ?? o.last ?? null;
  let ivm = o.vol ? o.vol / 100 : null;
  if (!ivm && mk != null && F) ivm = BS.iv(isC, F, o.k, T, mk);
  const ivb = o.bid != null && F ? BS.iv(isC, F, o.k, T, o.bid) : null;
  const iva = o.ask != null && F ? BS.iv(isC, F, o.k, T, o.ask) : null;
  const g = F && ivm ? BS.greeks(isC, F, o.k, T, ivm) : { delta: null, gamma: null, vega: null, theta: null };
  return { ...o, T, mark: mk, ivm, ivb, iva, ...g, itm: F ? (isC ? o.k < F : o.k > F) : false };
}
function underPrice(u) { return u ? (mid(u) ?? u.last ?? null) : null; }

function derive() {
  const s = App.snap, now = Date.now();
  const u = s.under && s.under.c === App.base ? s.under : null;
  const F = underPrice(u);
  const map = {}, byExp = {};
  for (const o of s.opts || []) {
    if (o.b && o.b !== App.base) continue;
    const x = enrich(o, F, now);
    map[x.c] = x;
    (byExp[x.e] = byExp[x.e] || []).push(x);
  }
  const exps = Object.keys(byExp).filter(e => BS.expiryMs(e) > now).sort();
  // позиции
  const pos = (s.pos || []).map(p => {
    if (p.opt) {
      const bF = p.opt.b === App.base && F ? F : underPrice(p.under);
      const x = map[p.sec] || enrich(p.opt, bF, now);
      return { ...p, kind: x.t, x, base: x.b, F: bF };
    }
    const fu = p.fut || (p.sec === App.base ? u : null);
    return { ...p, kind: 'F', x: fu, base: fu ? fu.c : p.sec, F: underPrice(fu) };
  });
  const posBySec = {}; pos.forEach(p => posBySec[p.sec] = p.qty);
  // ATM IV по выбранной экспирации
  let atmIV = null;
  const ex = App.expiry && byExp[App.expiry] ? App.expiry : exps[0];
  if (F && ex) {
    const list = byExp[ex]; let best = null;
    for (const o of list) if (!best || Math.abs(o.k - F) < Math.abs(best.k - F)) best = o;
    if (best) {
      const pair = list.filter(o => o.k === best.k && o.ivm);
      atmIV = pair.length ? pair.reduce((a, o) => a + o.ivm, 0) / pair.length : null;
    }
  }
  App.M = { u, F, map, byExp, exps, pos, posBySec, atmIV, now };
}

function onSnap(s) {
  App.snap = s;
  const bases = s.bases || [];
  if (!App.base || !bases.find(b => b.code === App.base)) {
    const pref = bases.slice().sort((a, b) => b.n - a.n).find(b => /^RI/.test(b.code)) || bases.slice().sort((a, b) => b.n - a.n)[0];
    if (pref) setBase(pref.code, true);
  }
  if (App.base && s.sub !== App.base && Date.now() - App.lastSub > 2000) { App.lastSub = Date.now(); send('SUB', [App.base]); }
  derive();
  if (!App.expiry || !App.M.byExp[App.expiry]) App.expiry = App.M.exps[0] || null;
  if (!App._hashDone) { App._hashDone = true; if (location.hash === '#calc') { switchView('calc'); return; } }
  renderAll();
}

function setBase(code, silent) {
  App.base = code; store.set('base', code);
  App.expiry = null; App.scrolledFor = null; App.ticket = null;
  App.lastSub = Date.now(); send('SUB', [code]);
  if (!silent && App.snap) { derive(); App.expiry = App.M.exps[0] || null; renderAll(); renderTicket(true); }
  if ((typeof Calc !== 'undefined')) Calc.onBase();
}

/* ============================ RENDER ============================ */
function renderAll() {
  renderHeader(); renderStatus(); renderExpBar();
  if (App.view === 'chain') { renderChain(); renderTicket(false); renderBottom(); renderMini(); }
  if ((typeof Calc !== 'undefined')) Calc.onSnap();
  if (typeof Fut !== 'undefined') Fut.render();
  handleEvents();
}

function renderHeader() {
  const s = App.snap, M = App.M;
  const sel = $('#baseSel');
  const bases = (s.bases || []).slice().sort((a, b) => a.code.localeCompare(b.code));
  const key = bases.map(b => b.code).join(',');
  if (sel.dataset.key !== key) {
    sel.innerHTML = bases.map(b => `<option value="${esc(b.code)}">${esc(b.name || b.code)} · ${esc(b.code)}</option>`).join('');
    sel.dataset.key = key;
  }
  if (App.base) sel.value = App.base;
  const u = M.u, sc = u ? u.sc || 0 : 0;
  $('#uLast').textContent = u ? fmt(u.last ?? M.F, sc) : '—';
  $('#uBA').innerHTML = u ? `<span class="g">${fmt(u.bid, sc)}</span> / <span class="r">${fmt(u.ask, sc)}</span>` : '—';
  $('#uIV').textContent = M.atmIV ? pct(M.atmIV) + '%' : '—';
  const l = s.limits;
  $('#acctBox').innerHTML = l ? `
    <div><label>Счёт ${esc(s.account || '')}</label><b>${fmt(l.total)}</b></div>
    <div title="Гарантийное обеспечение, заблокированное под позиции и заявки"><label>ГО · загрузка</label><span>${fmt(l.used)} <span class="${l.total && l.used / l.total > 0.7 ? 'r' : 'mut'}">${l.total ? (l.used / l.total * 100).toFixed(0) + '%' : ''}</span></span>
      <div class="load"><i style="width:${l.total ? Math.min(100, l.used / l.total * 100) : 0}%" class="${l.total && l.used / l.total > 0.7 ? 'hi' : ''}"></i></div></div>
    <div><label>Свободно</label><span>${fmt(l.free)}</span></div>
    <div><label>Вар. маржа</label><span class="${clsPL(l.vm)}">${fmt(l.vm, 0, true)}</span></div>` : `<div><label>Счёт</label><span>${esc(s.account || '—')}</span></div>`;
}

function renderStatus() {
  const el = $('#status');
  let cls = 'off', txt = 'Нет связи с сервером';
  if (App.mode === 'demo') { cls = 'demo'; txt = 'ДЕМО'; }
  else if (App.mode === 'live') {
    if (App.age != null && App.age >= 0 && App.age < 5) {
      cls = App.snap && App.snap.connected ? 'live' : 'off';
      txt = App.snap && App.snap.connected ? 'QUIK online' : 'QUIK: нет соединения с сервером брокера';
      if (App.snap && !App.snap.trading) txt += ' · торговля выкл';
    } else { txt = 'QUIK не отвечает (скрипт остановлен?)'; }
  }
  el.className = 'status ' + cls;
  el.innerHTML = `<i></i><span>${txt}</span>` + (App.mode !== 'demo' ? ` <button id="toDemo">Демо</button>` : (location.protocol !== 'file:' ? ` <button id="toLive">QUIK</button>` : ''));
  const d = $('#toDemo'); if (d) d.onclick = () => startDemo(false);
  const lv = $('#toLive'); if (lv) lv.onclick = () => { stopDemo(); App.mode = 'live'; App.autoDemo = false; renderStatus(); };
}

function renderExpBar() {
  const M = App.M, bar = $('#expBar');
  const posExp = new Set(M.pos.filter(p => p.x && p.x.e && p.base === App.base).map(p => p.x.e));
  bar.innerHTML = M.exps.map(e => {
    const d = Math.max(0, (BS.expiryMs(e) - M.now) / 864e5);
    return `<button data-e="${e}" class="${e === App.expiry ? 'active' : ''} ${posExp.has(e) ? 'has-pos' : ''}">${fmtExp(e)}<small>${d < 1 ? (d * 24).toFixed(0) + 'ч' : d.toFixed(0) + 'д'}</small></button>`;
  }).join('') || `<span class="mut">Нет серий опционов${App.mode === 'live' ? ' (ожидание данных от QUIK…)' : ''}</span>`;
}

const COLS = [
  { id: 'oi', h: 'ОИ', g: 'oi', f: (o) => fmt(o.oi) },
  { id: 'delta', h: 'Δ', g: 'greeks', f: o => o.delta == null ? '—' : o.delta.toFixed(2) },
  { id: 'gamma', h: 'Γ', g: 'greeks', f: o => o.gamma == null ? '—' : (o.gamma * 1e4).toFixed(2), title: 'гамма × 10⁴' },
  { id: 'vega', h: 'Vega', g: 'greeks', f: o => o.vega == null ? '—' : fmt(o.vega, o.sc || 0) },
  { id: 'go', h: 'ГО прод.', g: 'go', f: o => fmt(o.sd), title: 'ГО продавца, ₽ за 1 контракт' },
  { id: 'ivb', h: 'IV bid', cls: 'iv', f: o => o.ivb ? pct(o.ivb) : '—' },
  { id: 'bid', h: 'Bid', cls: 'bid', f: o => o.bid == null ? '' : fmt(o.bid, o.sc || 0) + (o.bq ? `<span class="sz">${o.bq}</span>` : '') },
  { id: 'mark', h: 'Mark', cls: 'mark', f: o => fmt(o.mark, o.sc || 0) },
  { id: 'ask', h: 'Ask', cls: 'ask', f: o => o.ask == null ? '' : fmt(o.ask, o.sc || 0) + (o.aq ? `<span class="sz">${o.aq}</span>` : '') },
  { id: 'iva', h: 'IV ask', cls: 'iv', f: o => o.iva ? pct(o.iva) : '—' },
  { id: 'ivm', h: 'IV', cls: 'iv', f: o => o.ivm ? pct(o.ivm) : '—' },
  { id: 'pos', h: 'Поз.', cls: 'pos', f: o => { const q = App.M.posBySec[o.c]; return q ? fmt(q, 0, true) : ''; } },
];

function renderChain() {
  const M = App.M, tbl = $('#chainTable');
  const list = M.byExp[App.expiry] || [];
  if (!list.length) { tbl.innerHTML = `<tr><td class="empty-msg">Нет данных</td></tr>`; return; }
  const showG = $('#optGreeks').checked, showOI = $('#optOI').checked, showGO = $('#optGO').checked;
  const cols = COLS.filter(c => (c.g !== 'greeks' || showG) && (c.g !== 'oi' || showOI) && (c.g !== 'go' || showGO));
  const callCols = cols, putCols = cols.slice().reverse();
  const strikes = {};
  for (const o of list) (strikes[o.k] = strikes[o.k] || {})[o.t] = o;
  let ks = Object.keys(strikes).map(Number).sort((a, b) => a - b);
  const F = M.F;
  const lim = +$('#optStrikes').value;
  if (F && ks.length > lim) {
    let ai = ks.findIndex(k => k >= F); if (ai < 0) ai = ks.length - 1;
    const a = Math.max(0, ai - Math.floor(lim / 2)); ks = ks.slice(a, a + lim);
  }
  const sel = App.ticket ? App.ticket.sec : null;
  const cell = (o, c, side) => {
    if (!o) return `<td></td>`;
    let cls = c.cls || '';
    if (o.itm) cls += ' itm';
    if (c.id === 'pos') { const q = M.posBySec[o.c]; if (q) cls += q > 0 ? ' L' : ' S'; }
    if ((c.id === 'bid' || c.id === 'ask') && o.c === sel) cls += ' sel';
    const data = (c.id === 'bid' || c.id === 'ask') ? ` data-sec="${esc(o.c)}" data-side="${c.id === 'bid' ? 'S' : 'B'}"` : '';
    return `<td class="${cls}"${data}${c.title ? ` title="${c.title}"` : ''}>${c.f(o)}</td>`;
  };
  let html = `<thead><tr>${callCols.map(c => `<th>${c.h}</th>`).join('')}<th class="k">Страйк</th>${putCols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>`;
  let atmDone = !F;
  const ncol = callCols.length * 2 + 1;
  for (const k of ks) {
    if (!atmDone && k >= F) {
      atmDone = true;
      html += `<tr class="atm-line">${'<td></td>'.repeat(callCols.length)}<td class="k"><span>${fmt(F, M.u ? M.u.sc || 0 : 0)}</span></td>${'<td></td>'.repeat(putCols.length)}</tr>`;
    }
    const r = strikes[k];
    html += `<tr data-k="${k}">${callCols.map(c => cell(r.C, c, 'C')).join('')}<td class="k">${fmt(k, (r.C || r.P).sc || 0)}</td>${putCols.map(c => cell(r.P, c, 'P')).join('')}</tr>`;
  }
  if (!atmDone) html += `<tr class="atm-line">${'<td></td>'.repeat(ncol)}</tr>`;
  html += '</tbody>';
  const sc = $('#chainScroll'), top = sc.scrollTop;
  tbl.innerHTML = html;
  const key = App.base + App.expiry;
  if (App.scrolledFor !== key) {
    App.scrolledFor = key;
    const atm = tbl.querySelector('tr.atm-line');
    if (atm) sc.scrollTop = Math.max(0, atm.offsetTop - sc.clientHeight / 2);
  } else sc.scrollTop = top;
}

/* ============================ TICKET ============================ */
function openTicket(sec, side, price) {
  const o = App.M.map[sec] || (App.M.pos.find(p => p.sec === sec) || {}).x;
  if (!o) return;
  const qty = store.get('qty', 1);
  App.ticket = { sec, side, price: price ?? (side === 'B' ? o.ask : o.bid) ?? o.mark, qty };
  if (App.view !== 'chain') switchView('chain');
  renderTicket(true);
  renderChain();
}

function ticketOpt() {
  const t = App.ticket; if (!t) return null;
  return App.M.map[t.sec] || (App.M.pos.find(p => p.sec === t.sec) || {}).x || null;
}

function renderTicket(rebuild) {
  const el = $('#ticket'), t = App.ticket;
  if (!t) {
    el.className = 'ticket empty';
    el.innerHTML = `<div class="ph">Нажмите на <b class="g">Bid</b> (продать) или <b class="r">Ask</b> (купить) в доске, чтобы открыть тикет</div>`;
    return;
  }
  const o = ticketOpt(); if (!o) return;
  const sc = o.sc || 0, st = o.st || Math.pow(10, -sc);
  if (rebuild || !el.querySelector('#tPrice')) {
    el.className = 'ticket';
    el.innerHTML = `
      <h4>${esc(o.c)}</h4>
      <div class="sub"><span class="tag ${o.t}">${o.t === 'C' ? 'CALL' : 'PUT'}</span> ${fmt(o.k, sc)} · ${fmtDate(o.e)} · ${esc(o.b || App.base)}</div>
      <div class="bs-seg"><button class="B" data-s="B">Купить</button><button class="S" data-s="S">Продать</button></div>
      <div class="field"><label><span>Цена</span><span id="tIV"></span></label>
        <div class="stepper"><button data-d="-1">−</button><input id="tPrice" type="number" step="${st}"><button data-d="1">+</button></div>
        <div class="quick"><button data-q="bid">Bid</button><button data-q="mark">Mark</button><button data-q="ask">Ask</button></div></div>
      <div class="field"><label><span>Количество</span><span id="tPos"></span></label>
        <div class="stepper"><button data-qd="-1">−</button><input id="tQty" type="number" min="1" step="1"><button data-qd="1">+</button></div></div>
      <div class="kv" id="tKv"></div>
      <button class="btn wide" id="tSend"></button>
      <div class="row2" style="margin-top:6px"><button class="btn sm ghost" id="tCalc">+ в калькулятор</button><button class="btn sm ghost" id="tClose">Закрыть тикет</button></div>
      <div id="tWarn"></div>`;
    el.querySelector('#tPrice').value = t.price ?? '';
    el.querySelector('#tQty').value = t.qty;
    el.querySelectorAll('.bs-seg button').forEach(b => b.onclick = () => { t.side = b.dataset.s; renderTicket(false); });
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { t.price = +((+$('#tPrice').value || 0) + st * b.dataset.d).toFixed(sc); $('#tPrice').value = t.price; renderTicket(false); });
    el.querySelectorAll('[data-qd]').forEach(b => b.onclick = () => { t.qty = Math.max(1, (+$('#tQty').value || 1) + +b.dataset.qd); $('#tQty').value = t.qty; renderTicket(false); });
    el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const x = ticketOpt(); const v = x[b.dataset.q]; if (v != null) { t.price = +(Math.round(v / st) * st).toFixed(sc); $('#tPrice').value = t.price; renderTicket(false); } });
    $('#tPrice').oninput = e => { t.price = +e.target.value; renderTicket(false); };
    $('#tQty').oninput = e => { t.qty = Math.max(1, Math.floor(+e.target.value || 1)); store.set('qty', t.qty); renderTicket(false); };
    $('#tClose').onclick = () => { App.ticket = null; renderTicket(true); renderChain(); };
    $('#tCalc').onclick = () => {
      const x = ticketOpt();
      Calc.addLeg({ kind: x.t, k: x.k, e: x.e, qty: t.side === 'B' ? t.qty : -t.qty, entry: t.price });
      toast(`Добавлено в калькулятор: ${t.side === 'B' ? '+' : '−'}${t.qty} ${x.c}`, 'ok');
    };
    $('#tSend').onclick = () => confirmOrders([{ sec: o.c, side: t.side, price: t.price, qty: t.qty, opt: ticketOpt() }]);
  }
  el.querySelectorAll('.bs-seg button').forEach(b => b.classList.toggle('active', b.dataset.s === t.side));
  const F = App.M.F && o.b === App.base ? App.M.F : (App.M.pos.find(p => p.sec === o.c) || {}).F;
  const ivp = F ? BS.iv(o.t === 'C', F, o.k, o.T, t.price) : null;
  $('#tIV').innerHTML = ivp ? `IV ${pct(ivp)}%` : '';
  const pq = App.M.posBySec[o.c];
  $('#tPos').innerHTML = pq ? `позиция: <b class="${pq > 0 ? 'g' : 'r'}">${fmt(pq, 0, true)}</b>` : '';
  const sgn = t.side === 'B' ? 1 : -1, rub = o.sp && st ? o.sp / st : null;
  const prem = (t.price || 0) * t.qty;
  $('#tKv').innerHTML = `
    <span>Bid / Mark / Ask</span><span><span class="g">${fmt(o.bid, sc)}</span> / ${fmt(o.mark, sc)} / <span class="r">${fmt(o.ask, sc)}</span></span>
    <span>IV (mark)</span><span>${o.ivm ? pct(o.ivm) + '%' : '—'}</span>
    <span>Δ / Γ позиции</span><span>${o.delta == null ? '—' : (o.delta * t.qty * sgn).toFixed(2)} / ${o.gamma == null ? '—' : (o.gamma * t.qty * sgn * 1e4).toFixed(2)}</span>
    <span>Vega / Θ в день</span><span>${fmt(o.vega * t.qty * sgn, sc)} / ${fmt(o.theta * t.qty * sgn, sc)}</span>
    <span>Премия</span><span>${fmt(prem, sc)} пт${rub ? ` · ${fmt(prem * rub)} ₽` : ''}</span>
    <span>ГО на заявку</span><span>${(t.side === 'B' ? o.bd : o.sd) ? fmt((t.side === 'B' ? o.bd : o.sd) * t.qty) + ' ₽' : '—'}</span>
    <span>Свободно после</span><span>${App.snap.limits && (t.side === 'B' ? o.bd : o.sd) ? fmt(App.snap.limits.free - (t.side === 'B' ? o.bd : o.sd) * t.qty) + ' ₽' : '—'}</span>
    <span>Шаг / стоимость шага</span><span>${fmt(st, sc)} / ${o.sp ? fmt(o.sp, 2) + ' ₽' : '—'}</span>`;
  const b = $('#tSend');
  b.className = 'btn wide ' + (t.side === 'B' ? 'buy' : 'sell');
  b.textContent = `${t.side === 'B' ? 'Купить' : 'Продать'} ${t.qty} × ${fmt(t.price, sc)}`;
  $('#tWarn').innerHTML = App.mode === 'live' && App.snap && !App.snap.trading
    ? `<div class="warn">Торговля в мосте выключена (ALLOW_TRADING=false в quik_bridge.lua). Заявка не будет отправлена.</div>` : '';
}

function confirmOrders(list) {
  list = list.filter(o => o.qty > 0 && o.price > 0);
  if (!list.length) { toast('Нет корректных заявок (цена и количество должны быть > 0)', 'err'); return; }
  const live = App.mode === 'live';
  modal(`<h3>Подтверждение ${list.length > 1 ? 'заявок' : 'заявки'}${live ? '' : ' (демо)'}</h3>
    <table class="grid"><thead><tr><th>Инструмент</th><th>Сторона</th><th>Цена</th><th>Кол-во</th></tr></thead><tbody>
    ${list.map(o => `<tr><td>${esc(o.sec)}</td><td class="${o.side === 'B' ? 'g' : 'r'}">${o.side === 'B' ? 'Покупка' : 'Продажа'}</td><td>${fmt(o.price, (o.opt && o.opt.sc) || 0)}</td><td>${o.qty}</td></tr>`).join('')}
    </tbody></table>
    ${live ? `<div class="warn">Лимитные заявки будут отправлены в QUIK на счёт ${esc(App.snap.account || '?')}.</div>` : ''}
    <div class="acts"><button class="btn ghost" data-close>Отмена</button><button class="btn primary" id="mOk">Отправить</button></div>`,
  () => {
    for (const o of list) send('ORDER', [o.sec, o.side, o.price, o.qty, 'ui' + Date.now().toString(36)]);
    toast(`Отправлено заявок: ${list.length}`, 'info');
  });
}

/* ============================ BOTTOM ============================ */
function renderBottom() {
  const s = App.snap, M = App.M, body = $('#bottomBody');
  const act = (s.orders || []).filter(o => o.active);
  $('#cntPos').textContent = M.pos.length ? `(${M.pos.length})` : '';
  $('#cntOrd').textContent = act.length ? `(${act.length})` : '';
  const errs = (s.events || []).filter(e => e.kind === 'err').length;
  $('#cntLog').textContent = errs ? `(${errs} ош.)` : '';
  if (App.tab === 'pos') body.innerHTML = posTable();
  if (App.tab === 'ord') body.innerHTML = ordTable(s.orders || []);
  if (App.tab === 'trd') body.innerHTML = trdTable(s.trades || []);
  if (App.tab === 'log') body.innerHTML = logTable(s.events || []);
}

function posTable() {
  const M = App.M;
  if (!M.pos.length) return `<div class="empty-msg">Нет открытых позиций</div>`;
  let tot = { pl: 0, rub: 0, d: 0, g: 0, v: 0, th: 0, go: 0 }, hasRub = true;
  const rows = M.pos.map(p => {
    const x = p.x || {}, sc = x.sc || 0;
    const markP = p.kind === 'F' ? (p.F ?? x.last) : x.mark;
    const pl = markP != null && p.avg != null ? (markP - p.avg) * p.qty : null;
    const rubK = x.sp && x.st ? x.sp / x.st : null;
    const rub = pl != null && rubK ? pl * rubK : null;
    const d = p.kind === 'F' ? p.qty : x.delta != null ? x.delta * p.qty : null;
    const g = p.kind === 'F' ? 0 : x.gamma != null ? x.gamma * p.qty : null;
    const v = p.kind === 'F' ? 0 : x.vega != null ? x.vega * p.qty : null;
    const th = p.kind === 'F' ? 0 : x.theta != null ? x.theta * p.qty : null;
    const goOne = p.qty > 0 ? x.bd : x.sd, go = goOne ? goOne * Math.abs(p.qty) : null;
    if (p.base === App.base) tot.go += go || 0;
    if (p.base === App.base) { tot.pl += pl || 0; if (rub == null) hasRub = false; tot.rub += rub || 0; tot.d += d || 0; tot.g += g || 0; tot.v += v || 0; tot.th += th || 0; }
    return `<tr>
      <td><span class="tag ${p.kind}">${p.kind === 'F' ? 'FUT' : p.kind === 'C' ? 'CALL' : 'PUT'}</span> ${esc(p.sec)}</td>
      <td>${esc(p.base || '')}</td><td>${p.kind === 'F' ? '' : fmt(x.k, sc)}</td><td>${x.e ? fmtDate(x.e) : ''}</td>
      <td class="${p.qty > 0 ? 'g' : 'r'}">${fmt(p.qty, 0, true)}</td><td>${fmt(p.avg, sc)}</td><td>${fmt(markP, sc)}</td>
      <td class="${clsPL(pl)}">${fmt(pl, sc, true)}</td><td class="${clsPL(rub)}">${fmt(rub, 0, true)}</td>
      <td>${d == null ? '—' : d.toFixed(2)}</td><td>${g == null ? '—' : (g * 1e4).toFixed(2)}</td><td>${fmt(v, sc)}</td><td>${fmt(th, sc)}</td>
      <td>${x.ivm ? pct(x.ivm) : '—'}</td><td>${fmt(go)}</td>
      <td><button class="lnk" data-close-pos="${esc(p.sec)}">Закрыть</button></td></tr>`;
  }).join('');
  return `<table class="grid"><thead><tr><th>Инструмент</th><th>База</th><th>Страйк</th><th>Эксп.</th><th>Кол-во</th><th>Ср. цена</th><th>Mark</th>
    <th>P&L, пт</th><th>P&L, ₽</th><th>Δ</th><th>Γ×10⁴</th><th>Vega</th><th>Θ/день</th><th>IV</th><th title="Сумма ГО по инструментам без портфельного зачёта">ГО*, ₽</th><th></th></tr></thead><tbody>${rows}
    <tr class="total"><td>Итого по ${esc(App.base)}</td><td></td><td></td><td></td><td></td><td></td><td></td>
    <td class="${clsPL(tot.pl)}">${fmt(tot.pl, 0, true)}</td><td class="${clsPL(tot.rub)}">${hasRub ? fmt(tot.rub, 0, true) : '—'}</td>
    <td>${tot.d.toFixed(2)}</td><td>${(tot.g * 1e4).toFixed(2)}</td><td>${fmt(tot.v)}</td><td>${fmt(tot.th)}</td><td></td><td>${fmt(tot.go)}</td><td></td></tr></tbody></table>
    <div class="mut" style="padding:6px 10px;font-size:11px">* ГО по инструментам без зачёта. Биржа считает ГО портфельно, фактическое ГО счёта: ${fmt(App.snap.limits && App.snap.limits.used)} ₽.</div>`;
}
function ordTable(list) {
  if (!list.length) return `<div class="empty-msg">Заявок нет</div>`;
  const sorted = list.slice().sort((a, b) => (b.active - a.active));
  return `<table class="grid"><thead><tr><th>Время</th><th>№</th><th>Инструмент</th><th>Сторона</th><th>Цена</th><th>Кол-во</th><th>Остаток</th><th>Статус</th><th></th></tr></thead><tbody>
  ${sorted.map(o => `<tr><td>${esc(o.time)}</td><td>${esc(o.num)}</td><td>${esc(o.sec)}</td><td class="${o.side === 'B' ? 'g' : 'r'}">${o.side === 'B' ? 'Покупка' : 'Продажа'}</td>
    <td>${fmt(o.price, 2)}</td><td>${o.qty}</td><td>${o.bal}</td><td>${o.active ? '<b class="y">активна</b>' : (o.bal === 0 ? 'исполнена' : 'снята')}</td>
    <td>${o.active ? `<button class="lnk" data-kill="${esc(o.num)}" data-sec="${esc(o.sec)}">Снять</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}
function trdTable(list) {
  if (!list.length) return `<div class="empty-msg">Сделок нет</div>`;
  return `<table class="grid"><thead><tr><th>Время</th><th>№</th><th>Инструмент</th><th>Сторона</th><th>Цена</th><th>Кол-во</th></tr></thead><tbody>
  ${list.map(t => `<tr><td>${esc(t.time)}</td><td>${esc(t.num)}</td><td>${esc(t.sec)}</td><td class="${t.side === 'B' ? 'g' : 'r'}">${t.side === 'B' ? 'Покупка' : 'Продажа'}</td><td>${fmt(t.price, 2)}</td><td>${t.qty}</td></tr>`).join('')}</tbody></table>`;
}
function logTable(list) {
  if (!list.length) return `<div class="empty-msg">Журнал пуст</div>`;
  return `<table class="grid"><tbody>${list.slice().reverse().map(e => `<tr><td style="width:90px">${new Date(e.t * 1000).toLocaleTimeString('ru-RU')}</td><td class="log-${e.kind}" style="text-align:left;white-space:normal">${esc(e.msg)}</td></tr>`).join('')}</tbody></table>`;
}

function renderMini() {
  const box = $('#miniSummary');
  if (!box.querySelector('canvas')) {
    box.innerHTML = `<h5>Профиль позиции ${'<span id="miniBase"></span>'}</h5><canvas id="miniCv" title="Открыть калькулятор"></canvas><div class="kv" id="miniKv"></div>`;
    $('#miniCv').onclick = () => switchView('calc');
  }
  $('#miniBase').textContent = App.base || '';
  if ((typeof Calc !== 'undefined')) Calc.drawMini($('#miniCv'), $('#miniKv'));
}

function handleEvents() {
  const evs = (App.snap.events || []);
  const first = App.seenEv.size === 0 && !App._evInit;
  for (const e of evs) {
    const k = e.t + e.msg;
    if (App.seenEv.has(k)) continue;
    App.seenEv.add(k);
    if (!first) toast(e.msg, e.kind);
  }
  App._evInit = true;
}

/* ============================ UI helpers ============================ */
function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 4000);
}
function modal(html, onOk) {
  const m = $('#modal');
  $('#modalCard').innerHTML = html; m.hidden = false;
  const close = () => { m.hidden = true; };
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  m.onclick = e => { if (e.target === m) close(); };
  const ok = $('#mOk'); if (ok) ok.onclick = () => { close(); onOk && onOk(); };
}
function switchView(v) {
  App.view = v;
  try { history.replaceState(null, '', v === 'calc' ? '#calc' : location.pathname); } catch { /* file:// */ }
  $$('.views button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  if (App.snap) renderAll();
  if (v === 'calc' && (typeof Calc !== 'undefined')) Calc.render(true);
}

/* ============================ EVENTS ============================ */
$$('.views button').forEach(b => b.onclick = () => switchView(b.dataset.view));
$('#baseSel').onchange = e => setBase(e.target.value);
$('#expBar').onclick = e => { const b = e.target.closest('button[data-e]'); if (b) { App.expiry = b.dataset.e; App.scrolledFor = null; renderAll(); } };
$('#chainTable').onclick = e => { const td = e.target.closest('td[data-sec]'); if (td) { const o = App.M.map[td.dataset.sec]; openTicket(td.dataset.sec, td.dataset.side, td.dataset.side === 'B' ? o.ask : o.bid); } };
['#optGreeks', '#optOI', '#optGO', '#optStrikes'].forEach(id => $(id).onchange = () => { App.scrolledFor = null; renderChain(); });
$('#bottomTabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (!b) return; App.tab = b.dataset.tab; $$('#bottomTabs button').forEach(x => x.classList.toggle('active', x === b)); renderBottom(); };
$('#bottomBody').onclick = e => {
  const k = e.target.closest('[data-kill]');
  if (k) { send('KILL', [k.dataset.sec, k.dataset.kill, 'ui' + Date.now().toString(36)]); return; }
  const c = e.target.closest('[data-close-pos]');
  if (c) {
    const p = App.M.pos.find(x => x.sec === c.dataset.closePos); if (!p) return;
    if (p.kind === 'F') { Fut.prefill(p.qty > 0 ? 'S' : 'B', Math.abs(p.qty)); return; }
    const side = p.qty > 0 ? 'S' : 'B';
    openTicket(p.sec, side, side === 'B' ? p.x.ask : p.x.bid);
    App.ticket.qty = Math.abs(p.qty); renderTicket(true);
  }
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });

window.addEventListener('DOMContentLoaded', startFeed);
