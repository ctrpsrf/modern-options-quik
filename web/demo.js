// Демо-фид: синтетические данные в том же формате, что и quik_bridge.lua
const Demo = (() => {
  const MONTH_CALL = 'ABCDEFGHIJKL', MONTH_PUT = 'MNOPQRSTUVWX';
  // go — ГО фьючерса на 1 контракт, ₽
  const BASES = [
    { code: 'RIZ6', name: 'RTS-12.26', S: 108500, kStep: 2500, n: 14, st: 10, sp: 13.6, ostep: 10, iv: 0.32, sc: 0, go: 26400 },
    { code: 'SiZ6', name: 'Si-12.26', S: 84250, kStep: 500, n: 16, st: 1, sp: 1, ostep: 1, iv: 0.17, sc: 0, go: 9600 },
    { code: 'BRZ6', name: 'BR-12.26', S: 71.4, kStep: 1, n: 14, st: 0.01, sp: 7.9, ostep: 0.01, iv: 0.36, sc: 2, go: 9800 },
  ];
  let sub = null, orderSeq = 1000, tradeSeq = 5000;
  const orders = [], trades = [], events = [];
  const posMap = {};  // sec -> {qty, avg}
  let opts = {};      // base -> [series]

  function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function expiries() {
    const now = new Date(), res = [];
    // ближайшие 4 четверга + 3-й четверг следующих месяцев
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    while (res.length < 4) { d = addDays(d, 1); if (d.getUTCDay() === 4) res.push(iso(d)); }
    for (let m = 1; m <= 3; m++) {
      let x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
      let c = 0; while (true) { if (x.getUTCDay() === 4 && ++c === 3) break; x = addDays(x, 1); }
      if (!res.includes(iso(x))) res.push(iso(x));
    }
    return res.sort();
  }

  function build() {
    const ex = expiries();
    for (const b of BASES) {
      const list = [];
      const atm = Math.round(b.S / b.kStep) * b.kStep;
      ex.forEach((e, ei) => {
        const mi = Number(e.slice(5, 7)) - 1, yd = e.slice(3, 4);
        const wk = ei < 4 && !ex.slice(4).includes(e) ? 'ABCD'[ei] : '';
        for (let i = -b.n; i <= b.n; i++) {
          const k = +(atm + i * b.kStep).toFixed(4);
          for (const t of ['C', 'P']) {
            const letter = (t === 'C' ? MONTH_CALL : MONTH_PUT)[mi];
            list.push({ c: `${b.code.slice(0, 2)}${k}B${letter}${yd}${wk}`, k, t, e, b: b.code, sc: b.sc,
                        st: b.ostep, sp: b.sp * (b.ostep / b.st), oi: Math.round(Math.random() * 3000 * Math.exp(-Math.abs(i) / 4)) });
          }
        }
      });
      opts[b.code] = list;
    }
    // демо-позиция: длинный стрэддл по RTS (гамма-лонг), дельту хеджируем фьючерсом
    const r = opts.RIZ6, e1 = ex[4] || ex[0];
    const atm = Math.round(BASES[0].S / 2500) * 2500;
    const find = (k, t) => r.find(o => o.e === e1 && o.k === k && o.t === t);
    const p1 = find(atm, 'C'), p2 = find(atm, 'P');
    if (p1) posMap[p1.c] = { qty: 10, avg: null };
    if (p2) posMap[p2.c] = { qty: 10, avg: null };
  }

  function smile(b, k, T) {
    const m = Math.log(k / b.S) / Math.max(Math.sqrt(T), 0.05);
    return Math.min(b.iv * (1 + 0.9 * m * m - 0.25 * m) * (1 + 0.15 * Math.exp(-T * 40)), b.iv * 2.2);
  }
  function round(v, step, sc) { return +(Math.round(v / step) * step).toFixed(sc); }

  function quoteOpt(o, b, now) {
    const T = BS.yearsTo(o.e, now);
    const vol = smile(b, o.k, T);
    const th = BS.price(o.t === 'C', b.S, o.k, T, vol);
    const spr = Math.max(o.st * 2, th * 0.04);
    const bid = th - spr / 2 >= o.st ? round(th - spr / 2, o.st, o.sc) : null;
    const ask = round(Math.max(th + spr / 2, o.st), o.st, o.sc);
    const d = Math.abs(BS.greeks(o.t === 'C', b.S, o.k, T, vol).delta);
    const premRub = th / o.st * o.sp;
    return { ...o, bid, ask, theor: round(th, o.st, o.sc), vol: +(vol * 100).toFixed(2), last: round(th, o.st, o.sc),
             bq: Math.ceil(Math.random() * 50), aq: Math.ceil(Math.random() * 50), v: Math.round(o.oi / 5),
             bd: Math.round(premRub), sd: Math.round(Math.min(b.go * (0.2 + 0.8 * d) + premRub, b.go * 1.5)) };
  }

  function quoteFut(b) {
    const bid = round(b.S - b.st, b.st, b.sc), ask = round(b.S + b.st, b.st, b.sc);
    const book = { bids: [], asks: [] };
    for (let i = 0; i < 10; i++) {
      book.bids.push([round(bid - i * b.st, b.st, b.sc), Math.ceil(Math.random() * (i ? 120 : 30))]);
      book.asks.push([round(ask + i * b.st, b.st, b.sc), Math.ceil(Math.random() * (i ? 120 : 30))]);
    }
    return { c: b.code, name: b.name, last: b.S, bid, ask, bq: book.bids[0][1], aq: book.asks[0][1],
             st: b.st, sp: b.sp, sc: b.sc, cls: 'SPBFUT', bd: b.go, sd: b.go,
             pmin: round(b.S * 0.9, b.st, b.sc), pmax: round(b.S * 1.1, b.st, b.sc), book };
  }

  function baseByCode(c) { return BASES.find(b => b.code === c); }
  function seriesBySec(sec) { for (const b in opts) { const o = opts[b].find(x => x.c === sec); if (o) return o; } return null; }

  function snapshot() {
    const now = Date.now();
    for (const b of BASES) b.S = round(b.S * (1 + (Math.random() - 0.5) * 0.0012), b.st, b.sc);
    let under = null, list = [];
    if (sub) {
      const b = baseByCode(sub);
      under = quoteFut(b);
      list = opts[sub].map(o => quoteOpt(o, b, now));
    }
    // исполнение демо-заявок
    for (const o of orders) {
      if (!o.active) continue;
      const fb = baseByCode(o.sec);
      let q;
      if (fb) q = quoteFut(fb);
      else { const s = seriesBySec(o.sec); if (!s) continue; q = quoteOpt(s, baseByCode(s.b), now); }
      if (o.side === 'B' && q.ask != null && o.price >= q.ask) fill(o, q.ask);
      else if (o.side === 'S' && q.bid != null && o.price <= q.bid) fill(o, q.bid);
    }
    const pos = [];
    for (const sec in posMap) {
      const p = posMap[sec]; if (!p.qty) continue;
      const fb = baseByCode(sec);
      if (fb) { pos.push({ sec, qty: p.qty, avg: p.avg, fut: quoteFut(fb), acc: 'DEMO' }); continue; }
      const s = seriesBySec(sec);
      const b = baseByCode(s.b);
      const q = quoteOpt(s, b, now);
      if (p.avg == null) p.avg = q.theor;
      pos.push({ sec, qty: p.qty, avg: p.avg, opt: q, acc: 'DEMO', under: quoteFut(b) });
    }
    // ГО: наивная сумма по позициям (на бирже считается портфельно, будет меньше)
    let used = 0;
    for (const p of pos) {
      const x = p.opt || p.fut;
      used += Math.abs(p.qty) * (p.qty > 0 ? x.bd : x.sd) * (p.opt ? 1 : 1);
    }
    for (const o of orders) if (o.active) used += o.bal * 3000;
    const total = 1500000;
    return {
      src: 'demo', ts: Math.floor(now / 1000), connected: true, trading: true, account: 'DEMO-FORTS', status: 'ok',
      bases: BASES.map(b => ({ code: b.code, name: b.name, n: opts[b.code].length, cls: 'SPBFUT' })),
      sub, under, opts: list, pos, orders: orders.slice().reverse(), trades: trades.slice().reverse(),
      limits: { total, used: Math.round(used), free: Math.round(total - used), vm: 3250 },
      events: events.slice(-40),
    };
  }

  function fill(o, px) {
    o.active = false; o.bal = 0;
    const price = px ?? o.price;
    const p = posMap[o.sec] || (posMap[o.sec] = { qty: 0, avg: price });
    const d = o.side === 'B' ? o.qty : -o.qty;
    if (p.qty === 0) p.avg = price;
    else if (Math.sign(p.qty) === Math.sign(d)) p.avg = (p.avg * Math.abs(p.qty) + price * o.qty) / (Math.abs(p.qty) + o.qty);
    else if (Math.abs(d) > Math.abs(p.qty)) p.avg = price;  // переворот
    p.qty += d;
    trades.push({ num: String(++tradeSeq), sec: o.sec, side: o.side, price, qty: o.qty, time: new Date().toTimeString().slice(0, 8) });
    events.push({ t: Date.now() / 1000, kind: 'ok', ref: o.ref, msg: `Исполнено ${o.side} ${o.sec} x${o.qty} @ ${price}` });
  }

  function command(cmd, args) {
    if (cmd === 'SUB') sub = args[0];
    if (cmd === 'ORDER') {
      const [sec, side, price, qty, ref] = args;
      const o = { num: String(++orderSeq), sec, cls: baseByCode(sec) ? 'SPBFUT' : 'SPBOPT', side, price: +price, qty: +qty, bal: +qty,
                  active: true, time: new Date().toTimeString().slice(0, 8), ref };
      orders.push(o);
      events.push({ t: Date.now() / 1000, kind: 'info', ref, msg: `Заявка №${o.num} ${side} ${sec} x${qty} @ ${price}` });
    }
    if (cmd === 'KILL') {
      const o = orders.find(x => x.num === args[1]);
      if (o && o.active) { o.active = false; events.push({ t: Date.now() / 1000, kind: 'info', ref: args[2], msg: `Снята заявка №${o.num}` }); }
    }
    if (cmd === 'KILLALL') {
      for (const o of orders) if (o.active && o.sec === args[0]) { o.active = false; events.push({ t: Date.now() / 1000, kind: 'info', ref: args[1], msg: `Снята заявка №${o.num}` }); }
    }
  }

  build();
  return { snapshot, command };
})();
