// Modern Option Trader QUIK — панель фьючерса: стакан, быстрая торговля, дельта-хедж (для гамма-лонга)
const Fut = (() => {
  let open = store.get('dock', true), width = store.get('dockW', 360);
  let qty = store.get('futQty', 1), slip = store.get('futSlip', 3), noConfirm = store.get('futNoConfirm', false);
  let price = null, builtFor = null;

  const U = () => App.M && App.M.u;
  const dec = () => (U() && U().sc) || 0;
  const step = () => (U() && U().st) || Math.pow(10, -dec());
  const rnd = v => +(Math.round(v / step()) * step()).toFixed(dec());

  function exposure() {
    const M = App.M, r = { optD: 0, optG: 0, fut: 0, futAvg: null, futPL: null, futRub: null };
    if (!M) return r;
    for (const p of M.pos) {
      if (p.base !== App.base) continue;
      if (p.kind === 'F') {
        r.fut += p.qty; r.futAvg = p.avg;
        const px = M.F ?? (p.x && p.x.last);
        if (px != null && p.avg != null) {
          r.futPL = (px - p.avg) * p.qty;
          const u = p.x || U(); if (u && u.sp && u.st) r.futRub = r.futPL * u.sp / u.st;
        }
      } else if (p.x && p.x.delta != null) { r.optD += p.x.delta * p.qty; r.optG += (p.x.gamma || 0) * p.qty; }
    }
    r.total = r.optD + r.fut;
    return r;
  }

  function aggressive(side) {
    const u = U(); if (!u) return null;
    let px = side === 'B' ? (u.ask ?? u.last) + slip * step() : (u.bid ?? u.last) - slip * step();
    if (side === 'B' && u.pmax) px = Math.min(px, u.pmax);
    if (side === 'S' && u.pmin) px = Math.max(px, u.pmin);
    return rnd(px);
  }

  function place(side, px, q) {
    const u = U(); if (!u || !(px > 0) || !(q > 0)) { toast('Укажите цену и количество', 'err'); return; }
    if (noConfirm) {
      send('ORDER', [u.c, side, px, q, 'fut' + Date.now().toString(36)]);
      toast(`${side === 'B' ? 'Покупка' : 'Продажа'} ${u.c} ×${q} @ ${fmt(px, dec())}`, 'info');
    } else confirmOrders([{ sec: u.c, side, price: px, qty: q, opt: u }]);
  }

  function build() {
    const u = U(); builtFor = App.base;
    price = u ? rnd(u.last ?? u.bid ?? 0) : null;
    $('#fdForm').innerHTML = `
      <div class="field"><label><span>Количество</span><span id="fdGo"></span></label>
        <div class="stepper"><button data-fq="-1">−</button><input id="fdQty" type="number" min="1" step="1" value="${qty}"><button data-fq="1">+</button></div>
        <div class="quick">${[1, 2, 5, 10, 20].map(n => `<button data-fqs="${n}">${n}</button>`).join('')}</div></div>
      <div class="row2">
        <button class="btn buy" id="fdMB">Купить<br><small id="fdMBp"></small></button>
        <button class="btn sell" id="fdMS">Продать<br><small id="fdMSp"></small></button>
      </div>
      <div class="field" style="margin-top:10px"><label><span>Лимитная цена</span><span class="mut">клик по стакану — подставить</span></label>
        <div class="stepper"><button data-fp="-1">−</button><input id="fdPrice" type="number" step="${step()}" value="${price ?? ''}"><button data-fp="1">+</button></div></div>
      <div class="row2"><button class="btn sm" id="fdLB">Купить лимит</button><button class="btn sm" id="fdLS">Продать лимит</button></div>
      <div class="fd-set">
        <label>Проскальзывание <input id="fdSlip" type="number" min="0" step="1" value="${slip}"> шаг.</label>
        <label class="chk"><input type="checkbox" id="fdNoConf" ${noConfirm ? 'checked' : ''}> без подтверждения</label>
      </div>`;
    const setQ = v => { qty = Math.max(1, Math.floor(v) || 1); $('#fdQty').value = qty; store.set('futQty', qty); render(); };
    $('#fdForm').querySelectorAll('[data-fq]').forEach(b => b.onclick = () => setQ(qty + +b.dataset.fq));
    $('#fdForm').querySelectorAll('[data-fqs]').forEach(b => b.onclick = () => setQ(+b.dataset.fqs));
    $('#fdQty').oninput = e => setQ(+e.target.value);
    $('#fdForm').querySelectorAll('[data-fp]').forEach(b => b.onclick = () => { price = rnd((+$('#fdPrice').value || 0) + step() * b.dataset.fp); $('#fdPrice').value = price; });
    $('#fdPrice').oninput = e => { price = +e.target.value; };
    $('#fdMB').onclick = () => place('B', aggressive('B'), qty);
    $('#fdMS').onclick = () => place('S', aggressive('S'), qty);
    $('#fdLB').onclick = () => place('B', price, qty);
    $('#fdLS').onclick = () => place('S', price, qty);
    $('#fdSlip').oninput = e => { slip = Math.max(0, Math.floor(+e.target.value || 0)); store.set('futSlip', slip); render(); };
    $('#fdNoConf').onchange = e => {
      noConfirm = e.target.checked; store.set('futNoConfirm', noConfirm);
      if (noConfirm) toast('Заявки по фьючерсу будут уходить сразу по клику', 'info');
    };
  }

  function render() {
    const dock = $('#futDock'), sp = $('#splitter');
    dock.style.display = open ? '' : 'none'; sp.style.display = open ? '' : 'none';
    dock.style.width = width + 'px';
    $('#dockBtn').classList.toggle('active', open);
    $('#dockBtn').textContent = open ? 'Фьючерс ◂' : 'Фьючерс ▸';
    if (!open || !App.M) return;
    const u = U(), d = dec();
    if (!u) { $('#fdHead').innerHTML = `<div class="empty-msg">Нет данных по фьючерсу ${esc(App.base || '')}</div>`; return; }
    if (builtFor !== App.base || !$('#fdQty')) build();

    $('#fdHead').innerHTML = `
      <div class="fd-title"><b>${esc(u.name || u.c)}</b> <span class="mut">${esc(u.c)}</span></div>
      <div class="fd-px">${fmt(u.last ?? App.M.F, d)}</div>
      <div class="kv">
        <span>ГО покуп. / продав.</span><span>${fmt(u.bd)} / ${fmt(u.sd)} ₽</span>
        <span>Шаг / стоимость</span><span>${fmt(u.st, d)} / ${u.sp ? fmt(u.sp, 2) + ' ₽' : '—'}</span>
      </div>`;

    const e = exposure(), absG = Math.abs(e.optG);
    const hedge = Math.round(-e.total);
    const move1 = absG > 1e-12 ? 1 / absG : null;        // движение цены, меняющее дельту на 1 контракт
    const F = App.M.F;
    $('#fdDelta').innerHTML = `
      <div class="fd-dbig"><label>Дельта портфеля</label><b class="${Math.abs(e.total) >= 1 ? 'y' : ''}">${e.total.toFixed(2)}</b></div>
      <div class="kv">
        <span>Опционы Δ / Γ×10⁴</span><span>${e.optD.toFixed(2)} / ${(e.optG * 1e4).toFixed(2)}</span>
        <span>Фьючерс</span><span class="${e.fut > 0 ? 'g' : e.fut < 0 ? 'r' : ''}">${fmt(e.fut, 0, true)}${e.futAvg != null && e.fut ? ` @ ${fmt(e.futAvg, d)}` : ''}</span>
        ${e.fut ? `<span>P&L фьючерса</span><span class="${clsPL(e.futPL)}">${fmt(e.futPL, d, true)} пт${e.futRub != null ? ' · ' + fmt(e.futRub, 0, true) + ' ₽' : ''}</span>` : ''}
        <span title="На сколько должна сдвинуться цена, чтобы дельта изменилась на 1 контракт">Шаг хеджа (Δ±1)</span><span>${move1 ? fmt(move1, d) + ' пт' + (F ? ` · ${(move1 / F * 100).toFixed(2)}%` : '') : '—'}</span>
        ${move1 && F ? `<span>Хедж-уровни</span><span><span class="r">${fmt(F - move1, d)}</span> / <span class="g">${fmt(F + move1, d)}</span></span>` : ''}
      </div>
      <button class="btn wide ${hedge > 0 ? 'buy' : hedge < 0 ? 'sell' : ''}" id="fdHedge" ${hedge ? '' : 'disabled'}>
        ${hedge ? `Хедж Δ→0: ${hedge > 0 ? 'купить' : 'продать'} ${Math.abs(hedge)}` : 'Дельта нейтральна'}</button>`;
    const hb = $('#fdHedge');
    if (hedge) hb.onclick = () => { const s = hedge > 0 ? 'B' : 'S'; place(s, aggressive(s), Math.abs(hedge)); };

    // стакан
    const book = u.book || { bids: u.bid != null ? [[u.bid, u.bq]] : [], asks: u.ask != null ? [[u.ask, u.aq]] : [] };
    const mine = {};
    for (const o of (App.snap.orders || [])) if (o.active && o.sec === u.c) mine[o.price] = (mine[o.price] || 0) + (o.side === 'B' ? o.bal : -o.bal);
    const maxQ = Math.max(1, ...book.bids.map(l => l[1] || 0), ...book.asks.map(l => l[1] || 0));
    const row = (l, side) => {
      const m = mine[l[0]];
      return `<tr data-px="${l[0]}" class="${side}"><td class="my">${m ? `<b class="${m > 0 ? 'g' : 'r'}">${Math.abs(m)}</b>` : ''}</td>
        <td class="px">${fmt(l[0], d)}</td><td class="q"><i style="width:${(l[1] || 0) / maxQ * 100}%"></i><span>${fmt(l[1])}</span></td></tr>`;
    };
    const spread = book.asks.length && book.bids.length ? book.asks[0][0] - book.bids[0][0] : null;
    $('#fdBook').innerHTML = `<table class="book"><tbody>
      ${book.asks.slice().reverse().map(l => row(l, 'a')).join('')}
      <tr class="spr"><td></td><td>${spread != null ? 'спред ' + fmt(spread, d) : ''}</td><td></td></tr>
      ${book.bids.map(l => row(l, 'b')).join('')}</tbody></table>`;

    // ГО на заявку и цены "по рынку"
    $('#fdGo').innerHTML = u.bd || u.sd ? `ГО: ${fmt((u.bd || 0) * qty)} / ${fmt((u.sd || 0) * qty)} ₽` : '';
    $('#fdMBp').textContent = `${qty} шт до ${fmt(aggressive('B'), d)}`;
    $('#fdMSp').textContent = `${qty} шт до ${fmt(aggressive('S'), d)}`;

    const act = (App.snap.orders || []).filter(o => o.active && o.sec === u.c);
    $('#fdOrders').innerHTML = `<div class="box-head"><h3>Заявки ${esc(u.c)} ${act.length ? `(${act.length})` : ''}</h3><div class="spacer"></div>
      ${act.length ? `<button class="btn sm ghost" id="fdKillAll">Снять все</button>` : ''}</div>
      ${act.length ? `<table class="grid"><tbody>${act.map(o => `<tr><td class="${o.side === 'B' ? 'g' : 'r'}">${o.side === 'B' ? 'Покупка' : 'Продажа'}</td>
        <td>${fmt(o.price, d)}</td><td>${o.bal}/${o.qty}</td><td><button class="lnk" data-fkill="${esc(o.num)}">Снять</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="mut" style="padding:4px 0 8px">нет активных</div>'}`;
    const ka = $('#fdKillAll'); if (ka) ka.onclick = () => send('KILLALL', [u.c, 'fut' + Date.now().toString(36)]);
  }

  // предзаполнить форму (например, «Закрыть» в позициях)
  function prefill(side, q) {
    open = true; store.set('dock', true);
    qty = q; store.set('futQty', q); builtFor = null; render();
    toast(`Объём ${q} установлен. Нажмите «${side === 'B' ? 'Купить' : 'Продать'}» в панели фьючерса`, 'info');
  }

  $('#dockBtn').onclick = () => { open = !open; store.set('dock', open); render(); };
  $('#fdBook').onclick = e => {
    const tr = e.target.closest('tr[data-px]'); if (!tr) return;
    price = +tr.dataset.px; const inp = $('#fdPrice'); if (inp) inp.value = price;
  };
  $('#fdOrders').onclick = e => {
    const k = e.target.closest('[data-fkill]');
    if (k && U()) send('KILL', [U().c, k.dataset.fkill, 'fut' + Date.now().toString(36)]);
  };
  // перетаскивание разделителя
  $('#splitter').onmousedown = e => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    document.body.classList.add('dragging');
    const mv = ev => { width = Math.min(760, Math.max(260, w0 - (ev.clientX - x0))); $('#futDock').style.width = width + 'px'; };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.classList.remove('dragging'); store.set('dockW', width); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  };

  render();
  return { render, prefill };
})();
