// Black-76 (опционы на фьючерсы, премиальные опционы MOEX: r = 0)
const BS = (() => {
  const SQ2PI = Math.sqrt(2 * Math.PI);
  const YEAR_MS = 365 * 864e5;

  function ncdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  }
  const npdf = x => Math.exp(-x * x / 2) / SQ2PI;

  function intrinsic(isCall, F, K) { return Math.max(isCall ? F - K : K - F, 0); }

  function price(isCall, F, K, T, v) {
    if (!(T > 0) || !(v > 0) || !(F > 0)) return intrinsic(isCall, F, K);
    const sd = v * Math.sqrt(T);
    const d1 = (Math.log(F / K) + sd * sd / 2) / sd, d2 = d1 - sd;
    return isCall ? F * ncdf(d1) - K * ncdf(d2) : K * ncdf(-d2) - F * ncdf(-d1);
  }

  // vega — на 1 п.п. волатильности, theta — за 1 календарный день
  function greeks(isCall, F, K, T, v) {
    if (!(T > 0) || !(v > 0) || !(F > 0)) {
      const itm = isCall ? F > K : F < K;
      return { delta: itm ? (isCall ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0 };
    }
    const sqT = Math.sqrt(T), sd = v * sqT;
    const d1 = (Math.log(F / K) + sd * sd / 2) / sd;
    const pdf = npdf(d1);
    return {
      delta: isCall ? ncdf(d1) : ncdf(d1) - 1,
      gamma: pdf / (F * sd),
      vega: F * pdf * sqT / 100,
      theta: -F * pdf * v / (2 * sqT) / 365,
    };
  }

  function iv(isCall, F, K, T, p) {
    if (!(p > 0) || !(T > 0) || !(F > 0)) return null;
    const intr = intrinsic(isCall, F, K);
    if (p <= intr + 1e-12) return null;
    if (p >= (isCall ? F : K)) return null;
    let lo = 1e-4, hi = 6;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (price(isCall, F, K, T, mid) > p) hi = mid; else lo = mid;
      if (hi - lo < 1e-6) break;
    }
    return (lo + hi) / 2;
  }

  // экспирация опционов MOEX — 18:50 МСК (UTC+3)
  function expiryMs(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 15, 50);
  }
  function yearsTo(dateStr, nowMs) {
    return Math.max((expiryMs(dateStr) - nowMs) / YEAR_MS, 0);
  }

  // вероятность, что цена на дату T выше X (лог-нормально, без сноса)
  function probAbove(F, X, T, v) {
    if (!(T > 0) || !(v > 0)) return F > X ? 1 : 0;
    const sd = v * Math.sqrt(T);
    return ncdf((Math.log(F / X) - sd * sd / 2) / sd);
  }

  return { ncdf, npdf, price, greeks, iv, intrinsic, expiryMs, yearsTo, probAbove, YEAR_MS };
})();
