// Modern Option Trader QUIK — опционный калькулятор / конструктор стратегий
const Calc = (() => {
  // [тип, сдвиг страйка в "ширинах", кол-во, сдвиг экспирации]
  const PRESETS = [
    { g: 'Базовые' },
    { n: 'Покупка колла', s: 'Long Call', l: [['C', 0, 1]] },
    { n: 'Покупка пута', s: 'Long Put', l: [['P', 0, 1]] },
    { n: 'Продажа колла', s: 'Short Call', l: [['C', 0, -1]] },
    { n: 'Продажа пута', s: 'Short Put', l: [['P', 0, -1]] },
    { g: 'Вертикальные спреды' },
    { n: 'Бычий колл-спред', s: 'Bull Call', l: [['C', 0, 1], ['C', 1, -1]] },
    { n: 'Медвежий пут-спред', s: 'Bear Put', l: [['P', 0, 1], ['P', -1, -1]] },
    { n: 'Бычий пут-спред', s: 'Bull Put (кредит)', l: [['P', 0, -1], ['P', -1, 1]] },
    { n: 'Медвежий колл-спред', s: 'Bear Call (кредит)', l: [['C', 0, -1], ['C', 1, 1]] },
    { g: 'Волатильность' },
    { n: 'Длинный стрэддл', s: 'Long Straddle', l: [['C', 0, 1], ['P', 0, 1]] },
    { n: 'Короткий стрэддл', s: 'Short Straddle', l: [['C', 0, -1], ['P', 0, -1]] },
    { n: 'Длинный стрэнгл', s: 'Long Strangle', l: [['C', 1, 1], ['P', -1, 1]] },
    { n: 'Короткий стрэнгл', s: 'Short Strangle', l: [['C', 1, -1], ['P', -1, -1]] },
    { n: 'Железный кондор', s: 'Iron Condor', l: [['P', -2, 1], ['P', -1, -1], ['C', 1, -1], ['C', 2, 1]] },
    { n: 'Железная бабочка', s: 'Iron Butterfly', l: [['P', -1, 1], ['P', 0, -1], ['C', 0, -1], ['C', 1, 1]] },
    { n: 'Колл-бабочка', s: 'Call Butterfly', l: [['C', -1, 1], ['C', 0, -2], ['C', 1, 1]] },
    { n: 'Пут-бабочка', s: 'Put Butterfly', l: [['P', -1, 1], ['P', 0, -2], ['P', 1, 1]] },
    { n: 'Колл-кондор', s: 'Call Condor', l: [['C', -1, 1], ['C', 0, -1], ['C', 1, -1], ['C', 2, 1]] },
    { n: 'Бабочка с разбитым крылом', s: 'Broken Wing', l: [['C', 0, 1], ['C', 1, -2], ['C', 3, 1]] },
    { g: 'Пропорциональные' },
    { n: 'Колл рацио 1×2', s: 'Call Ratio', l: [['C', 0, 1], ['C', 1, -2]] },
    { n: 'Пут рацио 1×2', s: 'Put Ratio', l: [['P', 0, 1], ['P', -1, -2]] },
    { n: 'Колл бэкспред', s: 'Call Backspread', l: [['C', 0, -1], ['C', 1, 2]] },
    { n: 'Пут бэкспред', s: 'Put Backspread', l: [['P', 0, -1], ['P', -1, 2]] },
    { n: 'Нефритовая ящерица', s: 'Jade Lizard', l: [['P', -1, -1], ['C', 1, -1], ['C', 2, 1]] },
    { g: 'Синтетика и хедж' },
    { n: 'Риск-реверсал', s: 'Risk Reversal', l: [['C', 1, 1], ['P', -1, -1]] },
    { n: 'Синтетический лонг', s: 'Synthetic Long', l: [['C', 0, 1], ['P', 0, -1]] },
    { n: 'Синтетический шорт', s: 'Synthetic Short', l: [['C', 0, -1], ['P', 0, 1]] },
    { n: 'Покрытый колл', s: 'Covered Call', l: [['F', 0, 1], ['C', 1, -1]] },
    { n: 'Защитный пут', s: 'Protective Put', l: [['F', 0, 1], ['P', -1, 1]] },
    { n: 'Коллар', s: 'Collar', l: [['F', 0, 1], ['P', -1, 1], ['C', 1, -1]] },
    { g: 'Календарные' },
    { n: 'Календарь колл', s: 'Call Calendar', l: [['C', 0, -1, 0], ['C', 0, 1, 1]] },
    { n: 'Календарь пут', s: 'Put Calendar', l: [['P', 0, -1, 0], ['P', 0, 1, 1]] },
    { n: 'Диагональ колл', s: 'Call Diagonal', l: [['C', 1, -1, 0], ['C', 0, 1, 1]] },
    { n: 'Двойной календарь', s: 'Double Calendar', l: [['P', -1, -1, 0], ['P', -1, 1, 1], ['C', 1, -1, 0], ['C', 1, 1, 1]] },
  ];

  let plan = [], posOff = new Set(), unit = 'pt', dateFrac = 0, ivShift = 0, rng = 12, hoverX = null;
  let planBase = null, idSeq = 1;
  const M = () => App.M;

  function load() { planBase = App.base; plan = store.get('plan.' + App.base, []); idSeq = plan.reduce((a, l) => Math.max(a, l.id || 0), 0) + 1; }
  function save() { store.set('plan.' + planBase, plan); }

  /* ------------------------ legs model ------------------------ */
  function findOpt(kind, k, e) { const l = M().byExp[e]; return l ? l.find(o => o.t === kind && o.k === k) : null; }
  function strikesOf(e) { return [...new Set((M().byExp[e] || []).map(o => o.k))].sort((a, b) => a - b); }
  function interpIV(kind, k, e) {
    const l = (M().byExp[e] || []).filter(o => o.ivm).sort((a, b) => a.k - b.k);
    if (!l.length) return M().atmIV || 0.3;
    let lo = null, hi = null;
    for (const o of l) { if (o.k <= k) lo = o; if (o.k >= k && !hi) hi = o; }
    if (!lo) return hi.ivm; if (!hi) return lo.ivm; if (hi.k === lo.k) return lo.ivm;
    return lo.ivm + (hi.ivm - lo.ivm) * (k - lo.k) / (hi.k - lo.k);
  }
  function rubK(x) {
    if (x && x.sp && x.st) return x.sp / x.st;
    const u = M().u; if (u && u.sp && u.st) return u.sp / u.st;
    const any = Object.values(M().map).find(o => o.sp && o.st);
    return any ? any.sp / any.st : null;
  }

  function legs() {
    if (!App.M) return [];
    if (planBase !== App.base) load();
    const out = [];
    if ($('#incPos').checked) {
      for (const p of M().pos) {
        if (p.base !== App.base || !p.x) continue;
        const id = 'pos:' + p.sec, x = p.x;
        const mark = p.kind === 'F' ? M().F : x.mark;
        out.push({ id, src: 'pos', on: !posOff.has(id), kind: p.kind, k: x.k, e: x.e, qty: p.qty,
                   entry: p.avg ?? mark, x: p.kind === 'F' ? M().u : x, sec: p.sec, mark });
      }
    }
    for (const l of plan) {
      const x = l.kind === 'F' ? M().u : findOpt(l.kind, l.k, l.e);
      out.push({ ...l, src: 'plan', x, sec: x ? x.c : null, mark: l.kind === 'F' ? M().F : x ? x.mark : null });
    }
    for (const l of out) {
      l.iv = l.kind === 'F' ? null : (l.ivo ? l.ivo / 100 : (l.x && l.x.ivm) || interpIV(l.kind, l.k, l.e));
      l.rk = rubK(l.x);
    }
    return out;
  }

  function horizon(ls) {
    const now = M().now;
    const exps = ls.filter(l => l.on && l.kind !== 'F' && l.e).map(l => BS.expiryMs(l.e)).filter(t => t > now);
    return exps.length ? Math.min(...exps) : now + 30 * 864e5;
  }
  function value(l, S, t, dv) {
    if (l.kind === 'F') return S;
    return BS.price(l.kind === 'C', S, l.k, BS.yearsTo(l.e, t), Math.max((l.iv || 0.3) + dv, 0.005));
  }
  function pl(ls, S, t, dv, u = unit) {
    let s = 0;
    for (const l of ls) {
      if (!l.on || l.entry == null) continue;
      const v = (value(l, S, t, dv) - l.entry) * l.qty;
      s += u === 'rub' ? v * (l.rk || 0) : v;
    }
    return s;
  }
  function greeksSum(ls, S, t, dv) {
    const g = { delta: 0, gamma: 0, vega: 0, theta: 0 };
    for (const l of ls) {
      if (!l.on) continue;
      if (l.kind === 'F') { g.delta += l.qty; continue; }
      const x = BS.greeks(l.kind === 'C', S, l.k, BS.yearsTo(l.e, t), Math.max((l.iv || 0.3) + dv, 0.005));
      for (const k in g) g[k] += x[k] * l.qty;
    }
    return g;
  }

  /* ------------------------ analytics ------------------------ */
  function analyze(ls, S0, tEnd) {
    const on = ls.filter(l => l.on && l.entry != null);
    if (!on.length || !S0) return null;
    const N = 1200, lo = S0 * 0.05, hi = S0 * 4;
    const xs = [], ys = [];
    for (let i = 0; i <= N; i++) { const S = lo * Math.pow(hi / lo, i / N); xs.push(S); ys.push(pl(on, S, tEnd, ivShift)); }
    let max = -Infinity, min = Infinity;
    ys.forEach(y => { if (y > max) max = y; if (y < min) min = y; });
    const slopeR = ys[N] - ys[N - 20];
    const eps = Math.max(1e-6, Math.abs(max - min) * 1e-4);
    const unlimP = slopeR > eps, unlimL = slopeR < -eps;
    const be = [];
    for (let i = 1; i <= N; i++) if ((ys[i - 1] < 0) !== (ys[i] < 0)) {
      const a = xs[i - 1], b = xs[i];
      be.push(a + (b - a) * (0 - ys[i - 1]) / (ys[i] - ys[i - 1]));
    }
    // вероятность прибыли на горизонте (лог-нормально, ATM IV)
    const T = Math.max((tEnd - M().now) / BS.YEAR_MS, 1e-6), v = Math.max((M().atmIV || 0.3) + ivShift, 0.01);
    let pop = 0;
    for (let i = 1; i <= N; i++) {
      if ((ys[i] + ys[i - 1]) / 2 > 0) pop += BS.probAbove(S0, xs[i - 1], T, v) - BS.probAbove(S0, xs[i], T, v);
    }
    pop += ys[0] > 0 ? 1 - BS.probAbove(S0, xs[0], T, v) : 0;
    pop += ys[N] > 0 ? BS.probAbove(S0, xs[N], T, v) : 0;
    let net = 0, netR = 0;
    for (const l of on) { if (l.kind !== 'F') { net += l.entry * l.qty; netR += l.entry * l.qty * (l.rk || 0); } }
    return { max, min, unlimP, unlimL, be, pop, net: unit === 'rub' ? netR : net };
  }

  /* ------------------------ chart ------------------------ */
  function niceStep(range, n) {
    const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }
  function setupCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  const C = { exp: '#3d8bff', now: '#ff9f43', pos: '#8a93a8', grid: '#1e2431', axis: '#7a849b', spot: '#f0b90b', g: 'rgba(31,199,126,.13)', r: 'rgba(242,73,92,.13)' };

  function curves(ls, S0, tEnd, tSel, lo, hi, N) {
    const xs = [], exp = [], sel = [], pos = [];
    const posL = ls.filter(l => l.src === 'pos');
    const showPos = posL.some(l => l.on) && ls.some(l => l.src === 'plan' && l.on);
    for (let i = 0; i <= N; i++) {
      const S = lo + (hi - lo) * i / N; xs.push(S);
      exp.push(pl(ls, S, tEnd, ivShift)); sel.push(pl(ls, S, tSel, ivShift));
      if (showPos) pos.push(pl(posL, S, tEnd, ivShift));
    }
    return { xs, exp, sel, pos: showPos ? pos : null };
  }

  function drawChart() {
    const cv = $('#payoff'); if (!cv || !App.M || App.view !== 'calc') return;
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const ls = legs(), S0 = M().F;
    const dec = M().u ? M().u.sc || 0 : 0;
    if (!S0 || !ls.some(l => l.on)) {
      ctx.fillStyle = C.axis; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(S0 ? 'Добавьте ноги: выберите готовый профиль ниже или нажмите «+ нога»' : 'Нет цены базового актива', w / 2, h / 2);
      return;
    }
    const tEnd = horizon(ls), tSel = M().now + (tEnd - M().now) * dateFrac / 1000;
    const lo = S0 * (1 - rng / 100), hi = S0 * (1 + rng / 100), N = 360;
    const cs = curves(ls, S0, tEnd, tSel, lo, hi, N);
    let ymin = Math.min(0, ...cs.exp, ...cs.sel, ...(cs.pos || [])), ymax = Math.max(0, ...cs.exp, ...cs.sel, ...(cs.pos || []));
    if (ymax - ymin < 1e-9) { ymax += 1; ymin -= 1; }
    const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
    const L = 70, R = 14, T = 14, B = 26, W = w - L - R, H = h - T - B;
    const X = S => L + (S - lo) / (hi - lo) * W, Y = v => T + (ymax - v) / (ymax - ymin) * H;

    // σ-диапазоны
    const Ty = Math.max((tEnd - M().now) / BS.YEAR_MS, 0), sv = Math.max((M().atmIV || 0.3) + ivShift, 0.01) * Math.sqrt(Ty);
    [[2, 'rgba(61,139,255,.035)'], [1, 'rgba(61,139,255,.06)']].forEach(([k, col]) => {
      const a = Math.max(lo, S0 * Math.exp(-k * sv)), b = Math.min(hi, S0 * Math.exp(k * sv));
      ctx.fillStyle = col; ctx.fillRect(X(a), T, X(b) - X(a), H);
    });
    // сетка
    ctx.font = '11px Segoe UI'; ctx.lineWidth = 1;
    const ys = niceStep(ymax - ymin, 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(ymin / ys) * ys; v <= ymax; v += ys) {
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(L, Y(v) + .5); ctx.lineTo(L + W, Y(v) + .5); ctx.stroke();
      ctx.fillStyle = C.axis; ctx.fillText(fmt(v, Math.abs(ys) < 1 ? 2 : 0), L - 6, Y(v));
    }
    const xsS = niceStep(hi - lo, Math.max(3, Math.floor(W / 110)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(lo / xsS) * xsS; v <= hi; v += xsS) {
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(X(v) + .5, T); ctx.lineTo(X(v) + .5, T + H); ctx.stroke();
      ctx.fillStyle = C.axis; ctx.fillText(fmt(v, xsS < 1 ? 2 : 0), X(v), T + H + 6);
    }
    // заливка прибыль/убыток под кривой экспирации
    const path = () => { ctx.beginPath(); cs.xs.forEach((S, i) => i ? ctx.lineTo(X(S), Y(cs.exp[i])) : ctx.moveTo(X(S), Y(cs.exp[i]))); };
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, W, Y(0) - T); ctx.clip();
    path(); ctx.lineTo(X(hi), Y(0)); ctx.lineTo(X(lo), Y(0)); ctx.closePath(); ctx.fillStyle = C.g; ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(L, Y(0), W, T + H - Y(0)); ctx.clip();
    path(); ctx.lineTo(X(hi), Y(0)); ctx.lineTo(X(lo), Y(0)); ctx.closePath(); ctx.fillStyle = C.r; ctx.fill(); ctx.restore();
    // ноль
    ctx.strokeStyle = '#3a4256'; ctx.beginPath(); ctx.moveTo(L, Y(0) + .5); ctx.lineTo(L + W, Y(0) + .5); ctx.stroke();
    // кривые
    const line = (arr, col, wd, dash) => {
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.setLineDash(dash || []);
      ctx.beginPath(); cs.xs.forEach((S, i) => i ? ctx.lineTo(X(S), Y(arr[i])) : ctx.moveTo(X(S), Y(arr[i]))); ctx.stroke(); ctx.restore();
    };
    if (cs.pos) line(cs.pos, C.pos, 1.5, [5, 4]);
    line(cs.sel, C.now, 2);
    line(cs.exp, C.exp, 2.2);
    // спот
    ctx.save(); ctx.strokeStyle = C.spot; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(S0) + .5, T); ctx.lineTo(X(S0) + .5, T + H); ctx.stroke(); ctx.restore();
    ctx.fillStyle = C.spot; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const sl = fmt(S0, dec), tw = ctx.measureText(sl).width + 10;
    ctx.fillRect(X(S0) - tw / 2, T, tw, 16); ctx.fillStyle = '#000'; ctx.fillText(sl, X(S0), T + 2);
    // точки безубытка
    for (let i = 1; i <= N; i++) if ((cs.exp[i - 1] < 0) !== (cs.exp[i] < 0)) {
      const a = cs.xs[i - 1], b = cs.xs[i], be = a + (b - a) * (0 - cs.exp[i - 1]) / (cs.exp[i] - cs.exp[i - 1]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(be), Y(0), 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = C.axis; ctx.textBaseline = 'bottom'; ctx.fillText(fmt(be, dec), X(be), Y(0) - 6);
    }
    // курсор
    const tip = $('#chartTip');
    if (hoverX != null && hoverX >= L && hoverX <= L + W) {
      const S = lo + (hoverX - L) / W * (hi - lo);
      const ve = pl(ls, S, tEnd, ivShift), vs = pl(ls, S, tSel, ivShift);
      ctx.strokeStyle = '#59627a'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hoverX + .5, T); ctx.lineTo(hoverX + .5, T + H); ctx.stroke(); ctx.setLineDash([]);
      [[ve, C.exp], [vs, C.now]].forEach(([v, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(hoverX, Y(v), 4, 0, 7); ctx.fill(); });
      const u = unit === 'rub' ? ' ₽' : '';
      const posV = cs.pos ? pl(ls.filter(l => l.src === 'pos'), S, tEnd, ivShift) : null;
      tip.innerHTML = `<b>${fmt(S, dec)}</b> <span class="mut">(${fmt((S / S0 - 1) * 100, 2, true)}%)</span><br>
        <span style="color:${C.exp}">■</span> Экспирация: <b class="${clsPL(ve)}">${fmt(ve, unit === 'rub' ? 0 : dec, true)}${u}</b><br>
        <span style="color:${C.now}">■</span> На дату: <b class="${clsPL(vs)}">${fmt(vs, unit === 'rub' ? 0 : dec, true)}${u}</b>` +
        (posV != null ? `<br><span style="color:${C.pos}">■</span> Только позиция: <b class="${clsPL(posV)}">${fmt(posV, unit === 'rub' ? 0 : dec, true)}${u}</b>` : '');
      tip.style.display = 'block';
      const tx = hoverX + 14 + 220 > w ? hoverX - 14 - tip.offsetWidth : hoverX + 14;
      tip.style.left = tx + 'px'; tip.style.top = (T + 24) + 'px';
    } else tip.style.display = 'none';

    $('#calcLegend').innerHTML = `<span><i style="border-color:${C.exp}"></i>На экспирацию ${fmtDate(new Date(tEnd).toISOString().slice(0, 10))}</span>
      <span><i style="border-color:${C.now}"></i>На дату оценки</span>
      ${cs.pos ? `<span><i style="border-color:${C.pos};border-top-style:dashed"></i>Только текущая позиция</span>` : ''}
      <span><i style="border-color:rgba(61,139,255,.5);border-top-width:8px"></i>±1σ / ±2σ</span>`;
  }

  /* ------------------------ ГО ------------------------ */
  // ГО ноги по биржевым ставкам BUYDEPO/SELLDEPO, без портфельного зачёта (оценка сверху)
  function legGO(l) {
    const x = l.kind === 'F' ? M().u : l.x;
    if (!x || !l.qty) return null;
    const one = l.qty > 0 ? x.bd : x.sd;
    return one ? one * Math.abs(l.qty) : null;
  }
  function goBlock(ls) {
    const lim = App.snap && App.snap.limits;
    let plan = 0, pos = 0, miss = false;
    for (const l of ls) {
      if (!l.on) continue;
      const g = legGO(l); if (g == null) { if (l.src === 'plan') miss = true; continue; }
      if (l.src === 'plan') plan += g; else pos += g;
    }
    return `
      <div class="stat"><label>ГО счёта (биржа)</label><b>${lim ? fmt(lim.used) + ' ₽' : '—'}</b></div>
      <div class="stat"><label>ГО плана, оценка</label><b>${plan ? '+' + fmt(plan) + ' ₽' : '—'}${miss ? ' <span class="mut" title="Нет ставок ГО по части ног">*</span>' : ''}</b></div>
      <div class="stat"><label>Свободно сейчас</label><b>${lim ? fmt(lim.free) + ' ₽' : '—'}</b></div>
      <div class="stat"><label>Свободно после плана</label><b class="${lim && lim.free - plan < 0 ? 'r' : ''}">${lim ? fmt(lim.free - plan) + ' ₽' : '—'}</b></div>
      <div class="stat full"><label>ГО позиции по инструментам (без зачёта)</label><b>${fmt(pos)} ₽</b></div>`;
  }

  /* ------------------------ side panels ------------------------ */
  function renderStats() {
    const ls = legs(), S0 = M().F;
    const tEnd = horizon(ls), tSel = M().now + (tEnd - M().now) * dateFrac / 1000;
    const days = (tSel - M().now) / 864e5, left = (tEnd - tSel) / 864e5;
    $('#dateLbl').textContent = `${new Date(tSel).toLocaleDateString('ru-RU')} · +${days.toFixed(1)} д · до эксп. ${left.toFixed(1)} д`;
    $('#ivLbl').textContent = (ivShift > 0 ? '+' : '') + ivShift + ' п.п.';
    $('#rngLbl').textContent = '±' + rng + '%';
    const a = analyze(ls, S0, tEnd), dec = unit === 'rub' ? 0 : (M().u ? M().u.sc || 0 : 0), u = unit === 'rub' ? ' ₽' : '';
    const st = $('#calcStats');
    if (!a) { st.innerHTML = `<div class="stat full"><label>Стратегия</label><b class="mut">нет активных ног</b></div>`; $('#calcGreeks').innerHTML = ''; $('#calcScen').innerHTML = ''; return; }
    const curNow = pl(ls, S0, M().now, 0);
    st.innerHTML = `
      <div class="stat"><label>Макс. прибыль</label><b class="g">${a.unlimP ? 'не огранич.' : fmt(a.max, dec, true) + u}</b></div>
      <div class="stat"><label>Макс. убыток</label><b class="r">${a.unlimL ? 'не огранич.' : fmt(a.min, dec, true) + u}</b></div>
      <div class="stat"><label>${a.net >= 0 ? 'Дебет (уплачено)' : 'Кредит (получено)'}</label><b>${fmt(Math.abs(a.net), dec)}${u}</b></div>
      <div class="stat"><label>Вероятн. прибыли</label><b>${(a.pop * 100).toFixed(1)}%</b></div>
      <div class="stat full"><label>Безубыток (экспирация)</label><b>${a.be.length ? a.be.map(x => fmt(x, M().u ? M().u.sc || 0 : 0)).join(' · ') : '—'}</b></div>
      <div class="stat full"><label>P&L сейчас (по mark)</label><b class="${clsPL(curNow)}">${fmt(curNow, dec, true)}${u}</b></div>
      ${goBlock(ls)}`;
    const posL = ls.filter(l => l.src === 'pos'), planL = ls.filter(l => l.src === 'plan');
    const gp = greeksSum(posL, S0, tSel, ivShift), gq = greeksSum(planL, S0, tSel, ivShift), gt = greeksSum(ls, S0, tSel, ivShift);
    const row = (n, k, f) => `<tr><td>${n}</td><td>${f(gp[k])}</td><td>${f(gq[k])}</td><td><b>${f(gt[k])}</b></td></tr>`;
    const f2 = v => v.toFixed(2), fg = v => (v * 1e4).toFixed(2), fv = v => fmt(v, 1);
    $('#calcGreeks').innerHTML = `<h5>Греки на дату оценки (пункты)</h5><table class="gtable">
      <tr><th></th><th>Позиция</th><th>План</th><th>Итого</th></tr>
      ${row('Дельта', 'delta', f2)}${row('Гамма ×10⁴', 'gamma', fg)}${row('Вега (1 п.п.)', 'vega', fv)}${row('Тета / день', 'theta', fv)}</table>`;
    const moves = [-10, -5, -3, -1, 0, 1, 3, 5, 10];
    $('#calcScen').innerHTML = `<h5>Сценарии</h5><table class="gtable"><tr><th style="text-align:left">Цена</th><th>На дату</th><th>Экспирация</th></tr>
      ${moves.map(m => { const S = S0 * (1 + m / 100), a1 = pl(ls, S, tSel, ivShift), a2 = pl(ls, S, tEnd, ivShift);
        return `<tr><td>${m > 0 ? '+' : ''}${m}% <span class="mut">${fmt(S, M().u ? M().u.sc || 0 : 0)}</span></td><td class="${clsPL(a1)}">${fmt(a1, dec, true)}</td><td class="${clsPL(a2)}">${fmt(a2, dec, true)}</td></tr>`; }).join('')}</table>`;
  }

  function renderLegs(force) {
    const tbl = $('#legsTable');
    if (!force && tbl.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') { updateLegsLive(); return; }
    const ls = legs(), exps = M().exps;
    if (!ls.length) { tbl.innerHTML = `<tr><td class="empty-msg">Нет ног. Позиции по ${esc(App.base)} появятся автоматически; план — через профили справа или «+ нога».</td></tr>`; return; }
    tbl.innerHTML = `<thead><tr><th></th><th>Источник</th><th>Тип</th><th>Экспирация</th><th>Страйк</th><th class="r">Кол-во</th><th class="r">Цена входа</th><th class="r">Mark</th><th class="r">IV %</th><th class="r">Δ</th><th class="r">P&L</th><th></th></tr></thead><tbody>` +
      ls.map(l => {
        const plan = l.src === 'plan', dec = (l.x && l.x.sc) || 0;
        const typeSel = plan ? `<select data-f="kind">${['C', 'P', 'F'].map(t => `<option ${t === l.kind ? 'selected' : ''} value="${t}">${t === 'C' ? 'Колл' : t === 'P' ? 'Пут' : 'Фьюч'}</option>`).join('')}</select>` : `<span class="tag ${l.kind}">${l.kind === 'F' ? 'FUT' : l.kind === 'C' ? 'CALL' : 'PUT'}</span>`;
        const expSel = l.kind === 'F' ? '' : plan ? `<select data-f="e">${exps.map(e => `<option ${e === l.e ? 'selected' : ''} value="${e}">${fmtDate(e)}</option>`).join('')}</select>` : fmtDate(l.e);
        const kSel = l.kind === 'F' ? '' : plan ? `<select data-f="k">${strikesOf(l.e).map(k => `<option ${k === l.k ? 'selected' : ''} value="${k}">${fmt(k, dec)}</option>`).join('')}</select>` : fmt(l.k, dec);
        return `<tr data-id="${l.id}" class="src-${l.src} ${l.on ? '' : 'off'}">
          <td><input type="checkbox" data-f="on" ${l.on ? 'checked' : ''}></td>
          <td>${plan ? '<span class="mut">план</span>' : '<span class="y">позиция</span>'}</td>
          <td>${typeSel}</td><td>${expSel}</td><td>${kSel}${plan && l.kind !== 'F' && !l.x ? ' <span class="r" title="Серия не найдена в доске">!</span>' : ''}</td>
          <td class="r">${plan ? `<input class="q" type="number" step="1" data-f="qty" value="${l.qty}">` : `<b class="${l.qty > 0 ? 'g' : 'r'}">${fmt(l.qty, 0, true)}</b>`}</td>
          <td class="r">${plan ? `<input type="number" step="any" data-f="entry" value="${l.entry ?? ''}">` : fmt(l.entry, dec)}</td>
          <td class="r" data-live="mark">${fmt(l.mark, dec)}</td>
          <td class="r">${l.kind === 'F' ? '' : `<input type="number" step="0.1" data-f="ivo" placeholder="${l.iv ? (l.iv * 100).toFixed(1) : ''}" value="${l.ivo ?? ''}">`}</td>
          <td class="r" data-live="delta"></td><td class="r" data-live="pl"></td>
          <td>${plan ? `<button class="x" data-del="${l.id}" title="Удалить">×</button>` : ''}</td></tr>`;
      }).join('') + '</tbody>';
    updateLegsLive(ls);
  }
  function updateLegsLive(ls) {
    ls = ls || legs();
    const S0 = M().F, now = M().now;
    for (const l of ls) {
      const tr = $('#legsTable').querySelector(`tr[data-id="${l.id}"]`); if (!tr) continue;
      const dec = (l.x && l.x.sc) || 0;
      const d = l.kind === 'F' ? l.qty : S0 ? BS.greeks(l.kind === 'C', S0, l.k, BS.yearsTo(l.e, now), l.iv || 0.3).delta * l.qty : null;
      const p = S0 && l.entry != null ? pl([{ ...l, on: true }], S0, now, 0) : null;
      tr.querySelector('[data-live="mark"]').textContent = fmt(l.mark, dec);
      tr.querySelector('[data-live="delta"]').textContent = d == null ? '—' : d.toFixed(2);
      const c = tr.querySelector('[data-live="pl"]'); c.textContent = fmt(p, unit === 'rub' ? 0 : dec, true); c.className = 'r ' + clsPL(p);
    }
  }

  function refreshPresetParams() {
    const exps = M().exps, pe = $('#pExp'), pk = $('#pK');
    const key = exps.join(',');
    if (pe.dataset.key !== key) {
      const cur = pe.value || App.expiry;
      pe.innerHTML = exps.map(e => `<option value="${e}">${fmtDate(e)}</option>`).join('');
      pe.dataset.key = key; pe.value = exps.includes(cur) ? cur : (App.expiry || exps[0] || '');
    }
    const ks = strikesOf(pe.value), kkey = pe.value + ks.join(',');
    if (pk.dataset.key !== kkey) {
      const F = M().F, atm = ks.reduce((b, k) => (b == null || Math.abs(k - F) < Math.abs(b - F)) ? k : b, null);
      pk.innerHTML = ks.map(k => `<option value="${k}">${fmt(k, 2).replace(/,00$/, '')}${k === atm ? ' (ATM)' : ''}</option>`).join('');
      pk.dataset.key = kkey; pk.value = atm;
    }
  }

  function presetIcon(p) {
    const S0 = 100, wd = 8, pts = [];
    const leg = p.l.map(([t, dk, q, de = 0]) => {
      const k = S0 + dk * wd, T = 0.06 + de * 0.08;
      return { t, k, q, T, prem: t === 'F' ? S0 : BS.price(t === 'C', S0, k, T, 0.35) };
    });
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i <= 60; i++) {
      const S = 70 + i, v = leg.reduce((a, l) => a + l.q * ((l.t === 'F' ? S : BS.price(l.t === 'C', S, l.k, l.T - 0.06, 0.35)) - l.prem), 0);
      pts.push([S, v]); mn = Math.min(mn, v); mx = Math.max(mx, v);
    }
    mn = Math.min(mn, 0); mx = Math.max(mx, 0); if (mx - mn < 1e-6) mx += 1;
    const X = s => (s - 70) / 60 * 100, Y = v => 3 + (mx - v) / (mx - mn) * 28;
    const d = pts.map(([s, v], i) => (i ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
    return `<svg viewBox="0 0 100 34" preserveAspectRatio="none"><line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}" stroke="#3a4256" stroke-width="1"/><path d="${d}" fill="none" stroke="#3d8bff" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function renderPresets() {
    $('#presetGrid').innerHTML = PRESETS.map((p, i) => p.g ? `<div class="pgroup">${p.g}</div>` :
      `<div class="preset" data-p="${i}" title="${p.s}">${presetIcon(p)}${p.n}<small>${p.s}</small></div>`).join('');
  }

  function applyPreset(p) {
    const exps = M().exps, e0 = $('#pExp').value, ei = exps.indexOf(e0), F = M().F;
    const center = +$('#pK').value, w = +$('#pW').value, Q = Math.max(1, Math.floor(+$('#pQ').value || 1)), byMark = $('#pPx').value === 'mark';
    const out = [];
    for (const [kind, dk, q, de = 0] of p.l) {
      if (kind === 'F') { out.push({ id: idSeq++, on: true, kind: 'F', qty: q * Q, entry: F }); continue; }
      const e = exps[ei + de];
      if (!e) { toast('Для календаря нужна следующая экспирация', 'err'); return; }
      const ks = strikesOf(e);
      let ci = 0; ks.forEach((k, i) => { if (Math.abs(k - center) < Math.abs(ks[ci] - center)) ci = i; });
      const k = ks[ci + dk * w];
      if (k == null) { toast('Не хватает страйков для такой ширины', 'err'); return; }
      const o = findOpt(kind, k, e);
      const entry = o ? (byMark ? o.mark : (q > 0 ? o.ask : o.bid) ?? o.mark) : null;
      out.push({ id: idSeq++, on: true, kind, k, e, qty: q * Q, entry });
    }
    if ($('#pReplace').checked) plan = [];
    plan.push(...out); save();
    dateFrac = 0; $('#dateSl').value = 0;
    render(true);
    toast(`Профиль «${p.n}» добавлен в план`, 'ok');
  }

  /* ------------------------ public ------------------------ */
  function render(force) {
    if (!App.M) return;
    if (planBase !== App.base) load();
    refreshPresetParams();
    renderLegs(force);
    renderStats();
    drawChart();
  }

  function addLeg(l) {
    if (planBase !== App.base) load();
    plan.push({ id: idSeq++, on: true, ...l }); save();
    if (App.view === 'calc') render(true);
  }

  function drawMini(cv, kv) {
    if (!App.M) return;
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const ls = legs(), S0 = M().F;
    if (!S0 || !ls.some(l => l.on)) {
      ctx.fillStyle = '#7a849b'; ctx.font = '12px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('Нет позиций и плана', w / 2, h / 2); kv.innerHTML = ''; return;
    }
    const tEnd = horizon(ls), lo = S0 * 0.88, hi = S0 * 1.12, N = 120;
    const a = [], b = [];
    for (let i = 0; i <= N; i++) { const S = lo + (hi - lo) * i / N; a.push(pl(ls, S, tEnd, 0, 'pt')); b.push(pl(ls, S, M().now, 0, 'pt')); }
    let mn = Math.min(0, ...a, ...b), mx = Math.max(0, ...a, ...b); if (mx - mn < 1e-9) mx += 1;
    const X = i => 4 + i / N * (w - 8), Y = v => 6 + (mx - v) / (mx - mn) * (h - 12);
    ctx.strokeStyle = '#3a4256'; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    ctx.strokeStyle = C.spot; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.setLineDash([]);
    [[b, C.now, 1.5], [a, C.exp, 2]].forEach(([arr, c, lw]) => { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); arr.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke(); });
    ctx.lineWidth = 1;
    const g = greeksSum(ls, S0, M().now, 0), cur = pl(ls, S0, M().now, 0, 'pt'), curR = pl(ls, S0, M().now, 0, 'rub');
    kv.innerHTML = `<span>P&L (mark)</span><span class="${clsPL(cur)}">${fmt(cur, 0, true)} пт · ${fmt(curR, 0, true)} ₽</span>
      <span>Δ / Γ×10⁴</span><span>${g.delta.toFixed(2)} / ${(g.gamma * 1e4).toFixed(2)}</span>
      <span>Vega / Θ день</span><span>${fmt(g.vega, 1)} / ${fmt(g.theta, 1)}</span>`;
  }

  function onSnap() { if (App.view === 'calc') render(false); }
  function onBase() { load(); posOff = new Set(); if (App.view === 'calc' && App.M) render(true); }

  // ---- events
  renderPresets();
  $('#presetGrid').onclick = e => { const el = e.target.closest('[data-p]'); if (el) applyPreset(PRESETS[+el.dataset.p]); };
  $('#pExp').onchange = () => { $('#pK').dataset.key = ''; refreshPresetParams(); };
  $('#incPos').onchange = () => render(true);
  $('#dateSl').oninput = e => { dateFrac = +e.target.value; renderStats(); drawChart(); };
  $('#ivSl').oninput = e => { ivShift = +e.target.value / 100; $('#ivLbl').textContent = (ivShift > 0 ? '+' : '') + e.target.value + ' п.п.'; renderStats(); drawChart(); };
  $('#rngSl').oninput = e => { rng = +e.target.value; renderStats(); drawChart(); };
  $('#unitSeg').onclick = e => { const b = e.target.closest('button[data-u]'); if (!b) return; unit = b.dataset.u; $$('#unitSeg button').forEach(x => x.classList.toggle('active', x === b)); render(true); };
  $('#addLeg').onclick = () => {
    const e = $('#pExp').value || App.expiry; const ks = strikesOf(e), F = M().F;
    const k = ks.reduce((b, x) => (b == null || Math.abs(x - F) < Math.abs(b - F)) ? x : b, null);
    const o = findOpt('C', k, e);
    addLeg({ kind: 'C', k, e, qty: 1, entry: o ? o.mark : null }); render(true);
  };
  $('#clearPlan').onclick = () => { plan = []; save(); render(true); };
  $('#sendPlan').onclick = () => {
    const ls = legs().filter(l => l.src === 'plan' && l.on);
    const bad = ls.filter(l => l.kind === 'F' || !l.x);
    if (bad.length) toast('Фьючерсные ноги и несуществующие серии пропущены — их нужно выставить в QUIK', 'info');
    confirmOrders(ls.filter(l => l.kind !== 'F' && l.x).map(l => ({ sec: l.x.c, side: l.qty > 0 ? 'B' : 'S', price: l.entry, qty: Math.abs(l.qty), opt: l.x })));
  };
  const lt = $('#legsTable');
  lt.onchange = e => {
    const f = e.target.dataset.f, tr = e.target.closest('tr[data-id]'); if (!f || !tr) return;
    const id = tr.dataset.id;
    if (id.startsWith('pos:')) { if (f === 'on') { e.target.checked ? posOff.delete(id) : posOff.add(id); } render(true); return; }
    const l = plan.find(x => String(x.id) === id); if (!l) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'on') l.on = v;
    if (f === 'kind') { l.kind = v; if (v === 'F') { l.entry = M().F; } else if (!l.e) { l.e = $('#pExp').value; l.k = +$('#pK').value; } }
    if (f === 'e') { l.e = v; const ks = strikesOf(v); if (!ks.includes(l.k)) l.k = ks.reduce((b, k) => (b == null || Math.abs(k - l.k) < Math.abs(b - l.k)) ? k : b, null); }
    if (f === 'k') l.k = +v;
    if (f === 'qty') l.qty = Math.trunc(+v) || 0;
    if (f === 'entry') l.entry = v === '' ? null : +v;
    if (f === 'ivo') l.ivo = v === '' ? null : +v;
    if (['kind', 'e', 'k'].includes(f)) { const o = l.kind !== 'F' ? findOpt(l.kind, l.k, l.e) : null; if (o) l.entry = o.mark; }
    save(); render(true);
  };
  lt.onclick = e => { const d = e.target.closest('[data-del]'); if (d) { plan = plan.filter(x => String(x.id) !== d.dataset.del); save(); render(true); } };
  const cv = $('#payoff');
  cv.onmousemove = e => { hoverX = e.offsetX; drawChart(); };
  cv.onmouseleave = () => { hoverX = null; drawChart(); };
  new ResizeObserver(() => drawChart()).observe(cv.parentElement);

  return { render, addLeg, drawMini, onSnap, onBase, legs };
})();
