/* VEGAS EMA Overlay
 * Extracted from MraJJqq/vegas-octopus-v4 assets/js/charts/kline-host-v4.js
 * Standalone browser ES module. Does not modify or depend on V4 runtime.
 */

export const EMA_DEFS = Object.freeze([
  { period: 12, color: "#f5d76e", width: 1.45 },
  { period: 36, color: "#BEE9F0", width: 1.15 },
  { period: 43, color: "#BEE9F0", width: 1.05 },
  { period: 144, color: "#f4d35e", width: 1.3 },
  { period: 169, color: "#f4d35e", width: 1.15 },
  { period: 576, color: "#ff4e5e", width: 1.3 },
  { period: 676, color: "#ff4e5e", width: 1.15 }
]);

export function calculateEma(candles, period) {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError("EMA period must be a positive integer");
  }
  const result = new Float64Array(candles.length);
  result.fill(Number.NaN);
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].c;
  let value = sum / period;
  result[period - 1] = value;
  const alpha = 2 / (period + 1);

  for (let i = period; i < candles.length; i++) {
    value = candles[i].c * alpha + value * (1 - alpha);
    result[i] = value;
  }
  return result;
}

export function calculateVegasEma(candles) {
  return new Map(EMA_DEFS.map(def => [
    def.period,
    calculateEma(candles, def.period)
  ]));
}

/*
 * Create a transparent EMA canvas overlay.
 * setView() accepts the K-line viewport geometry:
 * { barW, right, lo, hi, W, H, T0, B }.
 * setCandles() accepts normalized candles: [{ t, o, h, l, c }, ...].
 */
export function createVegasEmaOverlay({ canvas, view = null } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new TypeError("A canvas element is required");
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  let candles = [];
  let emas = new Map();
  let W = 0, H = 0, dpr = 1;
  let currentView = view;
  let raf = 0, destroyed = false;

  function ask() {
    if (!destroyed && !raf) raf = requestAnimationFrame(draw);
  }

  function resize() {
    if (destroyed) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ask();
  }

  function draw() {
    raf = 0;
    if (destroyed) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const v = currentView;
    if (!candles.length || !v || !W || !H ||
        !(v.barW > 0) || !(v.hi > v.lo) || v.lo <= 0) return;

    const { barW, right, lo, hi } = v;
    const rightGap = Number.isFinite(v.rightGap) ? v.rightGap : 0;
    const xOf = i => v.W - rightGap - (right - i + 0.5) * barW;
    const yOf = p => v.T0 +
      (Math.log(hi) - Math.log(p)) /
      (Math.log(hi) - Math.log(lo)) * (v.H - v.T0 - v.B);
    const iAt = x => right + 0.5 - (v.W - rightGap - x) / barW;
    const i0 = Math.max(0, Math.floor(iAt(0)));
    const i1 = Math.min(candles.length - 1, Math.ceil(iAt(v.W)));

    for (const def of EMA_DEFS) {
      const values = emas.get(def.period);
      if (!values) continue;

      ctx.beginPath();
      let started = false;
      for (let i = i0; i <= i1; i++) {
        const value = values[i];
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = xOf(i), y = yOf(value);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      if (started) {
        ctx.strokeStyle = def.color;
        ctx.lineWidth = def.width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  }

  function setCandles(next) {
    candles = Array.isArray(next) ? next : [];
    emas = calculateVegasEma(candles);
    ask();
  }

  function setView(next) {
    if (!next || ![
      next.barW, next.right, next.lo, next.hi,
      next.W, next.H, next.T0, next.B
    ].every(Number.isFinite)) return;
    currentView = next;
    ask();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect();
    if (raf) cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    candles = [];
    emas.clear();
    currentView = null;
  }

  return Object.freeze({ setCandles, setView, destroy });
}
