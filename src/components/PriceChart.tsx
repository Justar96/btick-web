import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Liveline } from "liveline";
import type { LivelinePoint } from "liveline";
import { snapshotsOptions } from "@/api/queries";
import styles from "./PriceChart.module.css";

const WINDOWS = [
  { label: "1m", secs: 60 },
  { label: "5m", secs: 300 },
  { label: "1h", secs: 3600 },
];

const MAX_WINDOW_SECS = 3600;

const formatPrice = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function toEpoch(iso: string): number {
  const ms = Date.parse(iso);
  return ms > 0 ? ms / 1000 : 0;
}

interface Props {
  symbol: string;
}

interface SnapshotRow {
  ts_second: string;
  price: string;
}

export function PriceChart({ symbol }: Props) {
  const [windowSecs, setWindowSecs] = useState(300);

  const backfillStart = useMemo(
    () => new Date(Date.now() - MAX_WINDOW_SECS * 1000).toISOString(),
    [],
  );
  const { data: backfillData } = useQuery(snapshotsOptions(symbol, backfillStart));

  const { data: liveData } = useQuery<SnapshotRow[]>({
    queryKey: ["price", "snapshots", "live", symbol],
    queryFn: () => [],
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const data: LivelinePoint[] = useMemo(() => {
    const bySecond = new Map<number, LivelinePoint>();

    for (const r of backfillData ?? []) {
      if (!r.ts_second || !r.price) continue;
      const t = toEpoch(r.ts_second);
      if (t === 0) continue;
      bySecond.set(Math.floor(t), { time: t, value: parseFloat(r.price) });
    }

    for (const r of liveData ?? []) {
      const t = toEpoch(r.ts_second);
      if (t === 0) continue;
      bySecond.set(Math.floor(t), { time: t, value: parseFloat(r.price) });
    }

    if (bySecond.size === 0) return [];

    const pts = Array.from(bySecond.values());
    pts.sort((a, b) => a.time - b.time);
    return pts;
  }, [backfillData, liveData]);

  const value = data.length > 0 ? data[data.length - 1].value : 0;
  const hasData = data.length >= 2;

  const handleWindowChange = useCallback((secs: number) => {
    setWindowSecs(secs);
  }, []);

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <Liveline
          data={data}
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