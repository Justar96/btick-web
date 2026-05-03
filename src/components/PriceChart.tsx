import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Liveline } from "liveline";
import type { LivelinePoint } from "liveline";
import { snapshotsOptions } from "@/api/queries";
import { usePrice } from "@/ws/context";
import styles from "./PriceChart.module.css";

const WINDOWS = [
  { label: "1m", secs: 60 },
  { label: "5m", secs: 300 },
  { label: "1h", secs: 3600 },
];

const MAX_WINDOW_SECS = 3600;
const TICK_THROTTLE_MS = 100;
const MAX_POINTS = 36_000;

const formatPrice = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

interface Props {
  symbol: string;
}

export function PriceChart({ symbol }: Props) {
  const [windowSecs, setWindowSecs] = useState(300);
  const live = usePrice(symbol);

  const backfillStart = useMemo(
    () => new Date(Date.now() - MAX_WINDOW_SECS * 1000).toISOString(),
    [],
  );
  const { data: backfillData } = useQuery(snapshotsOptions(symbol, backfillStart));

  const [points, setPoints] = useState<LivelinePoint[]>([]);
  const [prevSymbol, setPrevSymbol] = useState(symbol);
  const seededRef = useRef(false);
  const lastTickAtRef = useRef(0);

  // Reset chart state synchronously when symbol changes — otherwise the new
  // symbol's ticks would append onto the previous symbol's line.
  if (prevSymbol !== symbol) {
    setPrevSymbol(symbol);
    setPoints([]);
    seededRef.current = false;
    lastTickAtRef.current = 0;
  }

  useEffect(() => {
    if (seededRef.current) return;
    if (!backfillData || backfillData.length === 0) return;
    seededRef.current = true;

    const seeded: LivelinePoint[] = [];
    for (const r of backfillData) {
      if (!r.ts_second || !r.price) continue;
      const t = Date.parse(r.ts_second) / 1000;
      const v = parseFloat(r.price);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      seeded.push({ time: t, value: v });
    }
    seeded.sort((a, b) => a.time - b.time);

    setPoints((existingLive) => {
      if (existingLive.length === 0) return seeded;
      const liveStart = existingLive[0].time;
      const before = seeded.filter((p) => p.time < liveStart - 1e-3);
      return before.concat(existingLive);
    });
  }, [backfillData]);

  useEffect(() => {
    if (!live?.price) return;
    const v = parseFloat(live.price);
    if (!Number.isFinite(v)) return;

    const nowMs = Date.now();
    if (nowMs - lastTickAtRef.current < TICK_THROTTLE_MS) return;
    lastTickAtRef.current = nowMs;

    const point: LivelinePoint = { time: nowMs / 1000, value: v };
    setPoints((prev) => {
      const next = prev.length >= MAX_POINTS
        ? prev.slice(prev.length - MAX_POINTS + 1)
        : prev.slice();
      next.push(point);
      return next;
    });
  }, [live?.ts, live?.price]);

  const liveValue = live?.price ? parseFloat(live.price) : NaN;
  const value = Number.isFinite(liveValue)
    ? liveValue
    : points.length > 0
      ? points[points.length - 1].value
      : 0;

  const hasData = points.length >= 2;

  const handleWindowChange = useCallback((secs: number) => {
    setWindowSecs(secs);
  }, []);

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <Liveline
          data={points}
          value={value}
          loading={!hasData}
          window={windowSecs}
          windows={WINDOWS}
          windowStyle="rounded"
          onWindowChange={handleWindowChange}
          theme="light"
          badge={false}
          badgeTail={false}
          fill
          grid
          scrub
          momentum
          formatValue={formatPrice}
        />
      </div>
    </div>
  );
}
