const STATUS_URL = 'https://api.squeekchain.com/v1/status';
const POLL_MS = 1500;
const STALE_MS = 120_000;

function toNumber(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : fallback;
}

function emptyTelemetry() {
  return {
    ok: false,
    offline: true,
    coreStatus: 'IDLE',
    rpm: 0,
    speedMmPerSecond: 0,
    distanceMm: 0,
    cumulativeWorkUnits: 0,
    settledThroughRound: 0,
    blockHeight: 0,
    blockProgress: 0,
    observedAt: null,
    fetchedAt: 0,
    error: null,
  };
}

export function createWheelFeed(onUpdate) {
  let stopped = false;
  let timer = null;
  let last = emptyTelemetry();
  let lastSettled = null;

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch(STATUS_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const m = data?.measurement || {};
      const a = data?.builder?.anchor || {};
      const freshness = String(m.freshness || '').toLowerCase();
      const observedAt = m.observedAt ? Date.parse(m.observedAt) : NaN;
      const ageMs = Number.isFinite(observedAt) ? Date.now() - observedAt : Infinity;
      const stale =
        freshness === 'stale' ||
        freshness === 'offline' ||
        ageMs > (toNumber(m.staleAfterSeconds, 120) * 1000 || STALE_MS);

      const settledThroughRound = toNumber(a.settledThroughRound, last.settledThroughRound);
      const settlementIncreased =
        lastSettled != null && settledThroughRound > lastSettled;

      last = {
        ok: true,
        offline: stale || String(m.coreStatus || '').toUpperCase() === 'COUNTER_FAULT',
        coreStatus: String(m.coreStatus || 'IDLE').toUpperCase(),
        rpm: toNumber(m.rpmMilli) / 1000,
        speedMmPerSecond: toNumber(m.speedMmPerSecond),
        distanceMm: toNumber(m.distanceMm),
        cumulativeWorkUnits: toNumber(m.cumulativeWorkUnits),
        settledThroughRound,
        blockHeight: toNumber(a.blockHeight),
        blockProgress: toNumber(a.blockProgress),
        observedAt: m.observedAt || null,
        fetchedAt: Date.now(),
        error: null,
        settlementIncreased,
        previousSettled: lastSettled,
      };

      if (lastSettled == null) lastSettled = settledThroughRound;
      else if (settledThroughRound > lastSettled) lastSettled = settledThroughRound;

      onUpdate?.(last);
    } catch (err) {
      last = {
        ...last,
        ok: false,
        offline: true,
        fetchedAt: Date.now(),
        error: err?.message || 'status unavailable',
        settlementIncreased: false,
      };
      onUpdate?.(last);
    } finally {
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }
  }

  poll();

  return {
    get() {
      return last;
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Map live wheel telemetry into gameplay knobs. */
export function deriveWorldEnergy(tel) {
  const status = tel?.coreStatus || 'IDLE';
  const rpm = Math.max(0, tel?.rpm || 0);
  const speed = Math.max(0, tel?.speedMmPerSecond || 0);
  const offline = !tel || tel.offline || !tel.ok;
  const fault = status === 'COUNTER_FAULT';
  const active = !offline && !fault && status === 'ACTIVE' && (rpm > 0.05 || speed > 5);

  // Soft curves so IDLE stays playable and ACTIVE feels spicy.
  const rpmFactor = Math.min(1.8, rpm / 40); // ~40 rpm ≈ strong
  const speedFactor = Math.min(1.8, speed / 250);
  const activity = active ? Math.max(rpmFactor, speedFactor, 0.35) : 0.12;

  const scroll = active ? 4.2 + activity * 7.5 : 2.6 + activity * 1.2;
  const spawnEvery = active ? Math.max(0.55, 1.55 - activity * 0.55) : 2.1;
  const multiplier = active ? 1 + activity * 2.4 : 0.55 + activity * 0.4;

  return {
    active,
    offline: offline || fault,
    fault,
    scroll,
    spawnEvery,
    multiplier: Number(multiplier.toFixed(2)),
    rpm,
    speed,
    status: fault ? 'FAULT' : offline ? 'OFFLINE' : status,
  };
}
