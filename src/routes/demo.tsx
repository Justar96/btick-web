import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Liveline } from "liveline";
import type { LivelinePoint, LivelineSeries } from "liveline";
import styles from "./demo.module.css";

interface ExchangeConfig {
  min: number;
  max: number;
  enabled: boolean;
}

interface ExchangeState {
  name: string;
  label: string;
  color: string;
  abbr: string;
  price: number;
  basis: "trade" | "midpoint";
}

interface SimulationResult {
  median: number;
  basis: string;
  accepted: ExchangeState[];
  rejected: ExchangeState[];
  quality: number;
  degraded: boolean;
}

interface TickCell {
  deviation: number;
  accepted: boolean;
  active: boolean;
}

const EXCHANGES = ["binance", "coinbase", "kraken", "okx"] as const;
type ExchangeKey = (typeof EXCHANGES)[number];

const DEFAULT_CONFIGS: Record<ExchangeKey, ExchangeConfig> = {
  binance:  { min: 63500, max: 63800, enabled: true },
  coinbase: { min: 63400, max: 63700, enabled: true },
  kraken:   { min: 63600, max: 63900, enabled: true },
  okx:      { min: 63550, max: 63850, enabled: true },
};

const EXCHANGE_META: Record<ExchangeKey, { label: string; color: string; tint: string; abbr: string }> = {
  binance:  { label: "Binance",  color: "#f0b90b", tint: "rgba(240, 185, 11, 0.38)", abbr: "BN" },
  coinbase: { label: "Coinbase", color: "#0052ff", tint: "rgba(0, 82, 255, 0.32)",   abbr: "CB" },
  kraken:   { label: "Kraken",   color: "#5741d9", tint: "rgba(87, 65, 217, 0.32)",  abbr: "KR" },
  okx:      { label: "OKX",      color: "#525252", tint: "rgba(82, 82, 82, 0.30)",   abbr: "OX" },
};

const REJECT_TINT = "rgba(197, 48, 48, 0.45)";

const HISTORY_CAP = 240;
const CHART_WINDOW = 30;
const HEATMAP_CELLS = 36;

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[Math.floor(n / 2)];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function computeCanonical(
  prices: ExchangeState[],
  outlierPct: number,
  minSources: number,
): SimulationResult {
  if (prices.length === 0) {
    return { median: 0, basis: "none", accepted: [], rejected: [], quality: 0, degraded: true };
  }
  if (prices.length === 1) {
    const q = computeQuality(prices, false, 0);
    return {
      median: prices[0].price,
      basis: prices[0].basis === "midpoint" ? "single_midpoint" : "single_trade",
      accepted: prices,
      rejected: [],
      quality: q,
      degraded: prices.length < minSources,
    };
  }

  const rawPrices = prices.map((p) => p.price);
  let median = computeMedian(rawPrices);
  let accepted = [...prices];
  let rejected: ExchangeState[] = [];

  if (outlierPct > 0 && median > 0) {
    const threshold = outlierPct / 100;
    accepted = [];
    rejected = [];
    for (const p of prices) {
      const deviation = Math.abs(p.price - median) / median;
      if (deviation <= threshold) {
        accepted.push(p);
      } else {
        rejected.push(p);
      }
    }
    if (accepted.length > 0) {
      median = computeMedian(accepted.map((p) => p.price));
    } else {
      accepted = [...prices];
      rejected = [];
    }
  }

  const hasMidpoint = accepted.some((p) => p.basis === "midpoint");
  const basis = accepted.length === 1
    ? "single_trade"
    : hasMidpoint ? "median_mixed" : "median_trade";
  const degraded = accepted.length < minSources;
  const quality = computeQuality(accepted, false, 0);

  return { median, basis, accepted, rejected, quality, degraded };
}

function computeQuality(refs: ExchangeState[], isStale: boolean, carryDurSec: number): number {
  if (isStale) {
    const decay = Math.max(0, 1 - carryDurSec / 10);
    return Math.round(decay * 0.3 * 10000) / 10000;
  }
  if (refs.length === 0) return 0;

  const maxSources = 3;
  const sourceScore = Math.min(refs.length / maxSources, 1);
  const midpointCount = refs.filter((r) => r.basis === "midpoint").length;
  const midpointPenalty = 1 - (midpointCount / refs.length) * 0.2;
  const score = sourceScore * 0.5 + 1.0 * 0.3 + midpointPenalty * 0.2;
  return Math.round(score * 10000) / 10000;
}

function formatPrice(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pushPoint(arr: LivelinePoint[], time: number, value: number): LivelinePoint[] {
  const next = arr.length >= HISTORY_CAP ? arr.slice(arr.length - HISTORY_CAP + 1) : arr.slice();
  next.push({ time, value });
  return next;
}

function pushCell(arr: TickCell[], cell: TickCell): TickCell[] {
  const next = arr.length >= HEATMAP_CELLS ? arr.slice(arr.length - HEATMAP_CELLS + 1) : arr.slice();
  next.push(cell);
  return next;
}

type TickHistory = Record<ExchangeKey, TickCell[]>;
type PriceHistory = Record<ExchangeKey, LivelinePoint[]>;

const emptyTickHistory = (): TickHistory => ({
  binance: [],
  coinbase: [],
  kraken: [],
  okx: [],
});

const emptyPriceHistory = (): PriceHistory => ({
  binance: [],
  coinbase: [],
  kraken: [],
  okx: [],
});

export function DemoPage() {
  const [configs, setConfigs] = useState<Record<ExchangeKey, ExchangeConfig>>(DEFAULT_CONFIGS);
  const [prices, setPrices] = useState<ExchangeState[]>([]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(true);
  const [outlierPct, setOutlierPct] = useState(1.0);
  const [minSources, setMinSources] = useState(2);
  const [speed, setSpeed] = useState(800);
  const [canonical, setCanonical] = useState<LivelinePoint[]>([]);
  const [providerHistory, setProviderHistory] = useState<PriceHistory>(emptyPriceHistory);
  const [ticks, setTicks] = useState<TickHistory>(emptyTickHistory);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(() => {
    const next: ExchangeState[] = [];
    for (const key of EXCHANGES) {
      const cfg = configs[key];
      if (!cfg.enabled) continue;
      const meta = EXCHANGE_META[key];
      next.push({
        name: key,
        label: meta.label,
        color: meta.color,
        abbr: meta.abbr,
        price: randBetween(cfg.min, cfg.max),
        basis: "trade",
      });
    }
    setPrices(next);
    const res = computeCanonical(next, outlierPct, minSources);
    setResult(res);

    const t = Date.now() / 1000;
    if (res.median > 0) {
      setCanonical((prev) => pushPoint(prev, t, res.median));
    }

    setProviderHistory((prev) => {
      const updated: PriceHistory = { ...prev };
      for (const key of EXCHANGES) {
        const venue = next.find((p) => p.name === key);
        if (!configs[key].enabled || !venue) continue;
        updated[key] = pushPoint(prev[key], t, venue.price);
      }
      return updated;
    });

    setTicks((prev) => {
      const updated: TickHistory = { ...prev };
      for (const key of EXCHANGES) {
        const cfg = configs[key];
        const venue = next.find((p) => p.name === key);
        if (!cfg.enabled || !venue || res.median === 0) {
          updated[key] = pushCell(prev[key], { deviation: 0, accepted: false, active: false });
          continue;
        }
        const dev = (venue.price - res.median) / res.median;
        const accepted = res.accepted.some((a) => a.name === key);
        updated[key] = pushCell(prev[key], { deviation: dev, accepted, active: true });
      }
      return updated;
    });
  }, [configs, outlierPct, minSources]);

  useEffect(() => {
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(tick, speed);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, speed, tick]);

  const updateConfig = (name: ExchangeKey, patch: Partial<ExchangeConfig>) => {
    setConfigs((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  };

  const canonicalValue = result?.median ?? 0;
  const hasChart = canonical.length >= 2;

  const series: LivelineSeries[] = useMemo(() => {
    const list: LivelineSeries[] = [];
    for (const key of EXCHANGES) {
      if (!configs[key].enabled) continue;
      const data = providerHistory[key];
      if (!data || data.length === 0) continue;
      const current = prices.find((p) => p.name === key);
      const isRejected = result?.rejected.some((r) => r.name === key) ?? false;
      list.push({
        id: key,
        data,
        value: current?.price ?? data[data.length - 1].value,
        color: isRejected ? REJECT_TINT : EXCHANGE_META[key].tint,
        label: EXCHANGE_META[key].label,
      });
    }
    return list;
  }, [configs, providerHistory, prices, result]);

  const median = result?.median ?? 0;
  const enabledCount = EXCHANGES.filter((k) => configs[k].enabled).length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.eyebrow}>How it works · interactive</div>
        <h1 className={styles.title}>Multi-venue median, live.</h1>
        <p className={styles.subtitle}>
          Each exchange streams its own price. Outliers are rejected; the median of the
          remaining feeds becomes the canonical reference price. Drag the inputs to push
          a venue out of agreement and watch the system resist.
        </p>
      </header>

      <div className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <div className={styles.chartTitle}>
            <span className={styles.chartLabel}>btick canonical</span>
            <span className={styles.chartPrice}>
              {result && median > 0 ? formatPrice(median) : "—"}
            </span>
            <span className={styles.chartUnit}>USD</span>
          </div>
          <div className={styles.chartMeta}>
            {result?.degraded && <span className={styles.degradedBadge}>Degraded</span>}
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Basis</span>
              <span className={styles.metaValue}>
                {result?.basis.replace(/_/g, " ") ?? "—"}
              </span>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Sources</span>
              <span className={styles.metaValue}>
                {result?.accepted.length ?? 0}/{enabledCount}
              </span>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Quality</span>
              <span className={styles.metaValue}>
                {(result?.quality ?? 0).toFixed(3)}
              </span>
            </span>
          </div>
        </div>

        <div className={styles.chart}>
          <Liveline
            data={canonical}
            value={canonicalValue}
            series={series}
            window={CHART_WINDOW}
            theme="light"
            badge={false}
            badgeTail={false}
            fill
            grid
            scrub
            momentum
            lineWidth={1.5}
            loading={!hasChart}
            formatValue={formatPrice}
            seriesToggleCompact
          />
        </div>
      </div>

      <div className={styles.controlBar}>
        <button
          className={`${styles.playBtn} ${running ? styles.playBtnRunning : ""}`}
          onClick={() => setRunning((r) => !r)}
        >
          <span className={styles.playIcon}>
            {running ? (
              <>
                <span className={styles.pauseBar} />
                <span className={styles.pauseBar} />
              </>
            ) : (
              <span className={styles.playTri} />
            )}
          </span>
          {running ? "Pause" : "Play"}
        </button>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Tick rate</label>
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.controlValue}>{speed}ms</span>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Outlier threshold</label>
          <input
            type="range"
            min="0"
            max="5"
            step="0.1"
            value={outlierPct}
            onChange={(e) => setOutlierPct(Number(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.controlValue}>{outlierPct.toFixed(1)}%</span>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Min healthy sources</label>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={minSources}
            onChange={(e) => setMinSources(Number(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.controlValue}>{minSources}</span>
        </div>
      </div>

      <div className={styles.exchangeGrid}>
        {EXCHANGES.map((key) => {
          const cfg = configs[key];
          const meta = EXCHANGE_META[key];
          const current = prices.find((p) => p.name === key);
          const isRejected = result?.rejected.some((r) => r.name === key) ?? false;
          const isAccepted =
            (result?.accepted.some((r) => r.name === key) ?? false) && !isRejected;
          const cells = ticks[key];

          let deviationPct = 0;
          if (current && median > 0) {
            deviationPct = ((current.price - median) / median) * 100;
          }

          return (
            <div
              key={key}
              className={`${styles.card} ${cfg.enabled ? "" : styles.cardDisabled} ${
                isRejected ? styles.cardRejected : ""
              }`}
            >
              <div className={styles.cardHeader}>
                <span className={styles.cardIcon} style={{ backgroundColor: meta.color }}>
                  {meta.abbr}
                </span>
                <span className={styles.cardLabel}>{meta.label}</span>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={(e) => updateConfig(key, { enabled: e.target.checked })}
                  />
                  <span className={styles.toggleTrack} />
                </label>
              </div>

              <div className={styles.priceRow}>
                <span className={styles.priceValue}>
                  {current ? formatPrice(current.price) : "—"}
                </span>
                {cfg.enabled && current && (
                  <>
                    {isRejected && <span className={styles.rejectedBadge}>Rejected</span>}
                    {isAccepted && <span className={styles.acceptedBadge}>Accepted</span>}
                  </>
                )}
              </div>

              <Heatmap cells={cells} threshold={outlierPct} />

              <div className={styles.heatmapMeta}>
                <span className={styles.heatmapMetaLabel}>Δ vs canonical</span>
                <span
                  className={`${styles.heatmapMetaValue} ${isRejected ? styles.heatmapMetaValueOver : ""}`}
                >
                  {cfg.enabled && current && median > 0
                    ? `${deviationPct >= 0 ? "+" : ""}${deviationPct.toFixed(3)}%`
                    : "—"}
                </span>
              </div>

              <div className={styles.inputs}>
                <label className={styles.inputWrap}>
                  <span className={styles.inputLabel}>Min</span>
                  <input
                    type="number"
                    value={cfg.min}
                    onChange={(e) => updateConfig(key, { min: Number(e.target.value) })}
                    className={styles.input}
                    step="10"
                  />
                </label>
                <label className={styles.inputWrap}>
                  <span className={styles.inputLabel}>Max</span>
                  <input
                    type="number"
                    value={cfg.max}
                    onChange={(e) => updateConfig(key, { max: Number(e.target.value) })}
                    className={styles.input}
                    step="10"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.explanation}>
        <h3 className={styles.explanationTitle}>What happens each tick</h3>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <div className={styles.stepBody}>
              <strong>Sample.</strong> Each enabled venue emits a random price within its
              configured range — a stand-in for a real exchange feed.
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <div className={styles.stepBody}>
              <strong>Filter.</strong> Compute the median across all venues. Any feed
              deviating more than <code>{outlierPct.toFixed(1)}%</code> from that median is
              rejected as an outlier.
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <div className={styles.stepBody}>
              <strong>Reduce.</strong> Recompute the median across the remaining accepted
              feeds. That number becomes the canonical reference price.
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>4</span>
            <div className={styles.stepBody}>
              <strong>Score.</strong> Quality is derived from source count, freshness, and
              fallback usage. Below <code>{minSources}</code> healthy sources, the result
              is flagged degraded.
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}

interface HeatmapProps {
  cells: TickCell[];
  threshold: number;
}

function Heatmap({ cells, threshold }: HeatmapProps) {
  const padded: (TickCell | null)[] = [];
  const missing = HEATMAP_CELLS - cells.length;
  for (let i = 0; i < missing; i++) padded.push(null);
  for (const c of cells) padded.push(c);

  return (
    <div className={styles.heatmap} aria-label="Recent tick acceptance">
      {padded.map((cell, i) => {
        if (!cell || !cell.active) {
          return <span key={i} className={`${styles.heatCell} ${styles.heatCellEmpty}`} />;
        }
        const absDev = Math.abs(cell.deviation) * 100;
        const norm = threshold > 0 ? Math.min(absDev / threshold, 1.5) : 0;
        const className = cell.accepted
          ? styles.heatCellAccept
          : styles.heatCellReject;
        const intensity = cell.accepted
          ? 0.18 + Math.min(norm, 1) * 0.55
          : 0.55 + Math.min((norm - 1) / 0.8, 1) * 0.4;
        return (
          <span
            key={i}
            className={`${styles.heatCell} ${className}`}
            style={{ opacity: intensity }}
          />
        );
      })}
    </div>
  );
}
