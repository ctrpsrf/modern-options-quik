--[[
  Modern Option Trader QUIK: мост — мост между QUIK и веб-интерфейсом (опционы FORTS).

  Запуск: QUIK -> Сервисы -> Lua скрипты -> Добавить -> этот файл -> Запустить.
  Скрипт пишет снимок данных в  <папка скрипта>\data\out.json
  и читает команды из          <папка скрипта>\data\cmd.txt
  Веб-интерфейс обслуживает server.py (см. README.md).

  Важно: в QUIK включите  Система / Настройки / Основные настройки /
  Программа / Получение данных / «“Умный” заказ данных»,
  иначе котировки по неоткрытым в таблицах инструментам могут не приходить.
]]

local CFG = {
  -- true — заявки из интерфейса отправляются на биржу. false — торговля заблокирована.
  ALLOW_TRADING = true,

  ACCOUNT     = "",        -- торговый счёт FORTS (пусто = автоопределение)
  CLIENT_CODE = "",        -- код клиента (пусто = как ACCOUNT)
  OPT_CLASS   = "SPBOPT",  -- класс опционов
  PERIOD_MS   = 400,       -- период обновления снимка
  REINDEX_SEC = 900,       -- как часто перечитывать список серий
  DATA_DIR    = nil,       -- nil = <папка скрипта>\data
}

local running   = true
local CLS       = CFG.OPT_CLASS
local DIR, OUT, TMP, CMD
local index     = {}   -- code -> {c,k,t,e,b,bc}
local byBase    = {}   -- base -> {code,...}
local baseInfo  = {}   -- base -> {code,cls,name,n}
local sub       = nil  -- подписанный базовый актив
local requested = {}   -- "cls|sec" -> true
local lastSeq   = 0
local events    = {}
local pending   = {}   -- trans_id -> ref
local transId   = (os.time() % 100000) * 10
local account, firmId, clientCode
local status    = "init"
local lastIndex = 0

------------------------------------------------------------------ JSON
local ARR = {}
local function arr(t) return setmetatable(t or {}, ARR) end
local escMap = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
local function esc(s)
  return (s:gsub('[%c"\\]', function(c) return escMap[c] or string.format('\\u%04x', c:byte()) end))
end
local function isInt(v)
  if math.type then return math.type(v) == "integer" end
  return v == math.floor(v) and math.abs(v) < 1e15
end
local enc
enc = function(v, out)
  local t = type(v)
  if t == "nil" then out[#out + 1] = "null"
  elseif t == "boolean" then out[#out + 1] = v and "true" or "false"
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then out[#out + 1] = "null"
    elseif isInt(v) then out[#out + 1] = string.format("%d", v)
    else out[#out + 1] = string.format("%.10g", v) end
  elseif t == "string" then out[#out + 1] = '"' .. esc(v) .. '"'
  elseif t == "table" then
    if getmetatable(v) == ARR or v[1] ~= nil then
      out[#out + 1] = "["
      for i = 1, #v do if i > 1 then out[#out + 1] = "," end enc(v[i], out) end
      out[#out + 1] = "]"
    else
      out[#out + 1] = "{"
      local first = true
      for k, val in pairs(v) do
        if val ~= nil then
          if not first then out[#out + 1] = "," end
          first = false
          out[#out + 1] = '"' .. esc(tostring(k)) .. '":'
          enc(val, out)
        end
      end
      out[#out + 1] = "}"
    end
  else out[#out + 1] = "null" end
end
local function json(v) local out = {} enc(v, out) return table.concat(out) end

------------------------------------------------------------------ helpers
local function bitSet(flags, n) return math.floor((flags or 0) / n) % 2 == 1 end
local function numStr(n) if type(n) == "number" then return string.format("%.0f", n) end return tostring(n) end

local function P(cls, sec, name)
  local r = getParamEx2(cls, sec, name)
  if r and r.result == "1" then return tonumber(r.param_value) end
  return nil
end
local function PI(cls, sec, name)
  local r = getParamEx2(cls, sec, name)
  if r and r.result == "1" then return r.param_image end
  return nil
end
local function nz(v) if v == nil or v == 0 then return nil end return v end

local function pushEvent(kind, ref, msg)
  events[#events + 1] = { t = os.time(), kind = kind, ref = ref or "", msg = msg or "" }
  while #events > 60 do table.remove(events, 1) end
end

local function request(cls, sec, params)
  local key = cls .. "|" .. sec
  if requested[key] then return end
  requested[key] = true
  if ParamRequest then
    for _, p in ipairs(params) do pcall(ParamRequest, cls, sec, p) end
  end
end
local QUOTE_PARAMS = { "BID", "OFFER", "LAST", "THEORPRICE", "VOLATILITY", "NUMCONTRACTS",
                       "VOLTODAY", "BIDDEPTH", "OFFERDEPTH", "STEPPRICE", "SEC_PRICE_STEP",
                       "BUYDEPO", "SELLDEPO", "PRICEMIN", "PRICEMAX" }
local bookSec = nil  -- инструмент, на стакан которого подписаны

local function dateStr(n)
  if not n or n == 0 then return nil end
  local y = math.floor(n / 10000); local m = math.floor(n / 100) % 100; local d = n % 100
  return string.format("%04d-%02d-%02d", y, m, d)
end

-- тип опциона: по параметру OPTIONTYPE, иначе по букве месяца в коде (A-L колл, M-X пут)
local function optType(code)
  local img = PI(CLS, code, "OPTIONTYPE")
  if img and img ~= "" then
    local l = img:lower()
    if l:find("call") or l:find("олл") then return "C" end
    if l:find("put") or l:find("ут") then return "P" end
  end
  local m = code:match("^%a%a[%d%.]+%a(%a)%d")
  if m then
    local b = m:upper():byte()
    if b >= 65 and b <= 76 then return "C" end
    if b >= 77 and b <= 88 then return "P" end
  end
  return nil
end

------------------------------------------------------------------ index
local function buildIndex()
  status = "indexing"
  local list = getClassSecurities(CLS) or ""
  local newIndex, newBy, newBase = {}, {}, {}
  for code in list:gmatch("[^,]+") do
    local info = getSecurityInfo(CLS, code)
    if info and info.base_active_seccode and info.base_active_seccode ~= "" then
      local k = info.option_strike
      if not k or k == 0 then k = P(CLS, code, "STRIKE") end
      local t = optType(code)
      local e = dateStr(info.mat_date)
      if k and t and e then
        local b = info.base_active_seccode
        newIndex[code] = { c = code, k = k, t = t, e = e, b = b, bc = info.base_active_classcode or "SPBFUT",
                           sc = info.scale or 0, st = info.min_price_step }
        newBy[b] = newBy[b] or {}
        table.insert(newBy[b], code)
        if not newBase[b] then
          local bi = getSecurityInfo(info.base_active_classcode or "SPBFUT", b)
          newBase[b] = { code = b, cls = info.base_active_classcode or "SPBFUT",
                         name = bi and bi.short_name or b, n = 0,
                         sc = bi and bi.scale or 0, st = bi and bi.min_price_step or nil,
                         mat = bi and dateStr(bi.mat_date) or nil }
        end
        newBase[b].n = newBase[b].n + 1
      end
    end
  end
  index, byBase, baseInfo = newIndex, newBy, newBase
  lastIndex = os.time()
  status = "ok"
end

------------------------------------------------------------------ account
local function detectAccount()
  if CFG.ACCOUNT ~= "" then account = CFG.ACCOUNT end
  local n = getNumberOf("trade_accounts") or 0
  for i = 0, n - 1 do
    local a = getItem("trade_accounts", i)
    if a and a.class_codes and a.class_codes:find(CLS, 1, true) then
      if not account or account == a.trdaccid then
        account = a.trdaccid; firmId = a.firmid; break
      end
    end
  end
  clientCode = (CFG.CLIENT_CODE ~= "" and CFG.CLIENT_CODE) or account
end

------------------------------------------------------------------ snapshot parts
local function quote(cls, sec)
  request(cls, sec, QUOTE_PARAMS)
  return {
    bid = nz(P(cls, sec, "BID")), ask = nz(P(cls, sec, "OFFER")), last = nz(P(cls, sec, "LAST")),
    theor = nz(P(cls, sec, "THEORPRICE")), vol = nz(P(cls, sec, "VOLATILITY")),
    oi = P(cls, sec, "NUMCONTRACTS"), v = P(cls, sec, "VOLTODAY"),
    bq = P(cls, sec, "BIDDEPTH"), aq = P(cls, sec, "OFFERDEPTH"),
    sp = nz(P(cls, sec, "STEPPRICE")), st = nz(P(cls, sec, "SEC_PRICE_STEP")),
    bd = nz(P(cls, sec, "BUYDEPO")), sd = nz(P(cls, sec, "SELLDEPO")),   -- ГО покупателя / продавца, руб
    pmin = nz(P(cls, sec, "PRICEMIN")), pmax = nz(P(cls, sec, "PRICEMAX")),
  }
end

-- стакан: bid в QUIK отсортирован по возрастанию (лучший — последний), offer — по возрастанию (лучший — первый)
local function book(cls, sec, depth)
  if bookSec ~= sec then
    if bookSec and Unsubscribe_Level_II_Quotes then pcall(Unsubscribe_Level_II_Quotes, bookSec.cls, bookSec.sec) end
    if Subscribe_Level_II_Quotes then pcall(Subscribe_Level_II_Quotes, cls, sec) end
    bookSec = { cls = cls, sec = sec }
  end
  local q = getQuoteLevel2(cls, sec)
  local res = { bids = arr(), asks = arr() }
  if not q then return res end
  local nb = tonumber(q.bid_count) or 0
  local na = tonumber(q.offer_count) or 0
  if type(q.bid) == "table" then
    for i = nb, math.max(1, nb - depth + 1), -1 do
      local l = q.bid[i]
      if l then res.bids[#res.bids + 1] = { tonumber(l.price), tonumber(l.quantity) } end
    end
  end
  if type(q.offer) == "table" then
    for i = 1, math.min(na, depth) do
      local l = q.offer[i]
      if l then res.asks[#res.asks + 1] = { tonumber(l.price), tonumber(l.quantity) } end
    end
  end
  return res
end

local function optRow(code)
  local s = index[code]; if not s then return nil end
  local q = quote(CLS, code)
  q.c = code; q.k = s.k; q.t = s.t; q.e = s.e; q.b = s.b; q.sc = s.sc
  q.st = q.st or s.st
  return q
end

local function underRow(b)
  local bi = baseInfo[b]; if not bi then return nil end
  local q = quote(bi.cls, b)
  q.c = b; q.cls = bi.cls; q.name = bi.name; q.sc = bi.sc; q.st = q.st or bi.st; q.mat = bi.mat
  return q
end

local function positions()
  local res, seen = arr(), {}
  local n = getNumberOf("futures_client_holding") or 0
  for i = 0, n - 1 do
    local h = getItem("futures_client_holding", i)
    if h and h.totalnet and h.totalnet ~= 0 and (not account or h.trdaccid == account) then
      local key = h.trdaccid .. "|" .. h.sec_code
      if not seen[key] then
        seen[key] = true
        local p = { sec = h.sec_code, qty = h.totalnet, avg = h.avrposnprice, vm = h.varmargin, acc = h.trdaccid }
        if index[h.sec_code] then
          p.opt = optRow(h.sec_code)
          p.under = underRow(index[h.sec_code].b)
        elseif baseInfo[h.sec_code] then
          p.fut = underRow(h.sec_code)
        end
        res[#res + 1] = p
      end
    end
  end
  return res
end

local function timeStr(dt)
  if not dt then return "" end
  return string.format("%02d:%02d:%02d", dt.hour or 0, dt.min or 0, dt.sec or 0)
end

local function orders()
  local res = arr()
  local n = getNumberOf("orders") or 0
  local from = math.max(0, n - 200)
  for i = n - 1, from, -1 do
    local o = getItem("orders", i)
    if o and (not account or o.account == account) then
      local active = bitSet(o.flags, 1)
      if active or #res < 40 then
        res[#res + 1] = { num = numStr(o.order_num), sec = o.sec_code, cls = o.class_code,
          side = bitSet(o.flags, 4) and "S" or "B", price = o.price, qty = o.qty, bal = o.balance,
          active = active, time = timeStr(o.datetime), tid = o.trans_id }
      end
    end
  end
  return res
end

local function trades()
  local res = arr()
  local n = getNumberOf("trades") or 0
  for i = n - 1, math.max(0, n - 50), -1 do
    local t = getItem("trades", i)
    if t and (not account or t.account == account) then
      res[#res + 1] = { num = numStr(t.trade_num), sec = t.sec_code, side = bitSet(t.flags, 4) and "S" or "B",
        price = t.price, qty = t.qty, time = timeStr(t.datetime) }
    end
  end
  return res
end

local function num(v) return tonumber(v) end

-- ГО и средства. 1) таблица «Ограничения по клиентским счетам» (обычный счёт FORTS);
-- 2) «Клиентский портфель» через getPortfolioInfoEx (единая денежная позиция, ЕДП)
local function limits()
  local n = getNumberOf("futures_client_limits") or 0
  local best = nil
  for i = 0, n - 1 do
    local l = getItem("futures_client_limits", i)
    if l and (not account or l.trdaccid == account) then
      if not best or l.limit_type == 0 then best = l end
    end
  end
  if best then
    return { total = best.cbplimit, used = best.cbplused, free = best.cbplplanned, vm = best.varmargin,
             acc = best.accruedint, src = "futures_client_limits" }
  end
  if getPortfolioInfoEx and firmId then
    local codes = {}
    if CFG.CLIENT_CODE ~= "" then codes[#codes + 1] = CFG.CLIENT_CODE end
    if getClientCode then local ok, c = pcall(getClientCode); if ok and c and c ~= "" then codes[#codes + 1] = c end end
    if account then codes[#codes + 1] = account end
    for _, code in ipairs(codes) do
      for _, kind in ipairs({ 0, 1, 2 }) do
        local ok, p = pcall(getPortfolioInfoEx, firmId, code, kind)
        if ok and type(p) == "table" then
          local goPos, goOrd = num(p.go_for_positions), num(p.go_for_orders)
          local total = num(p.fut_asset) or num(p.all_assets) or num(p.portfolio_value)
          local used = (goPos or goOrd) and ((goPos or 0) + (goOrd or 0)) or num(p.init_margin)
          if total and total ~= 0 then
            return { total = total, used = used, free = used and (total - used) or nil,
                     vm = num(p.varmargin), go_pos = goPos, go_ord = goOrd,
                     rate_go = num(p.fut_rate_go), src = "portfolio:" .. code .. ":" .. kind }
          end
        end
      end
    end
  end
  return nil
end

------------------------------------------------------------------ trading
local function fmtPrice(price, scale)
  scale = scale or 0
  return string.format("%." .. math.floor(scale) .. "f", price)
end

local function classOf(sec)
  if index[sec] then return CLS, index[sec].sc end
  if baseInfo[sec] then return baseInfo[sec].cls, baseInfo[sec].sc end
  local info = getSecurityInfo("SPBFUT", sec)
  if info then return "SPBFUT", info.scale end
  return CLS, 0
end

local function sendOrder(sec, op, price, qty, ref)
  if not CFG.ALLOW_TRADING then
    pushEvent("err", ref, "Торговля выключена: ALLOW_TRADING=false в quik_bridge.lua")
    return
  end
  if not account then pushEvent("err", ref, "Не найден торговый счёт FORTS") return end
  local cls, scale = classOf(sec)
  transId = transId + 1
  local t = {
    ACCOUNT = account, CLIENT_CODE = clientCode, TYPE = "L", TRANS_ID = tostring(transId),
    CLASSCODE = cls, SECCODE = sec, ACTION = "NEW_ORDER", OPERATION = op,
    PRICE = fmtPrice(price, scale), QUANTITY = tostring(math.floor(qty)),
  }
  local res = sendTransaction(t)
  if res ~= "" then pushEvent("err", ref, "Отклонено QUIK: " .. res)
  else
    pending[transId] = ref
    pushEvent("info", ref, string.format("Отправлена заявка %s %s %s x%d @ %s", t.TRANS_ID, op, sec, math.floor(qty), t.PRICE))
  end
end

local function killOrder(sec, num, ref)
  if not CFG.ALLOW_TRADING then pushEvent("err", ref, "Торговля выключена: ALLOW_TRADING=false") return end
  local cls = classOf(sec)
  transId = transId + 1
  local res = sendTransaction({ ACCOUNT = account, CLASSCODE = cls, SECCODE = sec, TRANS_ID = tostring(transId),
                                ACTION = "KILL_ORDER", ORDER_KEY = numStr(num) })
  if res ~= "" then pushEvent("err", ref, "Снятие отклонено: " .. res)
  else pending[transId] = ref; pushEvent("info", ref, "Снятие заявки " .. tostring(num)) end
end

function OnTransReply(r)
  local ref = pending[r.trans_id]
  if ref == nil then return end
  local st = r.status or 0
  if st == 3 then pushEvent("ok", ref, "Исполнено: " .. (r.result_msg or "") .. (r.order_num and (" №" .. tostring(r.order_num)) or ""))
  elseif st > 3 then pushEvent("err", ref, "Ошибка: " .. (r.result_msg or tostring(st)))
  else return end
  pending[r.trans_id] = nil
end

------------------------------------------------------------------ commands
local function splitLine(line)
  local parts = {}
  for p in (line .. "|"):gmatch("([^|]*)|") do parts[#parts + 1] = p end
  return parts
end

local function readFile(path)
  local f = io.open(path, "rb"); if not f then return nil end
  local d = f:read("*a"); f:close(); return d
end

local function handle(p)
  local cmd = p[2]
  if cmd == "SUB" then sub = p[3]
  elseif cmd == "ORDER" then
    sendOrder(p[3], p[4], tonumber(p[5]), tonumber(p[6]), p[7])
  elseif cmd == "KILL" then killOrder(p[3], p[4], p[5])
  elseif cmd == "KILLALL" then
    -- снять все активные заявки по инструменту
    local n = getNumberOf("orders") or 0
    for i = 0, n - 1 do
      local o = getItem("orders", i)
      if o and o.sec_code == p[3] and bitSet(o.flags, 1) and (not account or o.account == account) then
        killOrder(o.sec_code, o.order_num, p[4])
      end
    end
  elseif cmd == "REINDEX" then buildIndex()
  end
end

local function readCmds(execute)
  local data = readFile(CMD); if not data then return end
  local now = os.time()
  for line in data:gmatch("[^\r\n]+") do
    local p = splitLine(line)
    local seq = tonumber(p[1])
    if seq and seq > lastSeq then
      lastSeq = seq
      if execute then
        if seq / 1000 < now - 20 then pushEvent("err", p[7] or "", "Команда устарела и пропущена: " .. line)
        else handle(p) end
      end
    end
  end
end

------------------------------------------------------------------ main
local function writeOut(tbl)
  local s = json(tbl)
  local f = io.open(TMP, "wb"); if not f then return end
  f:write(s); f:close()
  os.remove(OUT)
  os.rename(TMP, OUT)
end

local function tick()
  readCmds(true)
  if os.time() - lastIndex > CFG.REINDEX_SEC then buildIndex() end
  if not account then detectAccount() end

  local bases = arr()
  for _, b in pairs(baseInfo) do bases[#bases + 1] = { code = b.code, name = b.name, n = b.n, cls = b.cls, mat = b.mat } end

  local opts = arr()
  local under = nil
  if sub and byBase[sub] then
    under = underRow(sub)
    if under then under.book = book(under.cls, sub, 10) end
    for _, code in ipairs(byBase[sub]) do opts[#opts + 1] = optRow(code) end
  end

  writeOut({
    src = "quik", ts = os.time(), ack = lastSeq, status = status,
    connected = isConnected() == 1, trading = CFG.ALLOW_TRADING,
    account = account, firm = firmId,
    bases = bases, sub = sub, under = under, opts = opts,
    pos = positions(), orders = orders(), trades = trades(), limits = limits(),
    events = arr(events),
  })
end

function OnStop()
  running = false
  return 2000
end

function main()
  DIR = CFG.DATA_DIR or (getScriptPath() .. "\\data")
  OUT = DIR .. "\\out.json"; TMP = DIR .. "\\out.tmp"; CMD = DIR .. "\\cmd.txt"
  local probe = io.open(DIR .. "\\.probe", "wb")
  if not probe then
    message("Modern Option Trader QUIK: не найдена папка " .. DIR .. " — создайте её рядом со скриптом", 3)
    return
  end
  probe:close(); os.remove(DIR .. "\\.probe")

  readCmds(false)  -- пропустить старые команды, оставшиеся в файле
  detectAccount()
  buildIndex()
  local cnt = 0 for _ in pairs(baseInfo) do cnt = cnt + 1 end
  message(string.format("Modern Option Trader QUIK: мост запущен. Базовых активов: %d, счёт: %s, торговля: %s",
    cnt, tostring(account), CFG.ALLOW_TRADING and "ВКЛ" or "выкл"), 1)

  while running do
    local ok, err = pcall(tick)
    if not ok then pushEvent("err", "", "Ошибка tick: " .. tostring(err)) end
    sleep(CFG.PERIOD_MS)
  end
end
