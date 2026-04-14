import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { highlight } from "sugar-high";
import {
  verifySettlementResponseAttestation,
  type SettlementPrice,
} from "@/api/attestation";
import {
  attestationPublicKeyOptions,
  settlementPriceOptions,
} from "@/api/queries";
import styles from "./api.module.css";

const PLATFORM_CARDS = [
  {
    label: "Transports",
    value: "REST + WebSocket",
    detail: "HTTPS for point-in-time reads, WebSocket for live fan-out.",
  },
  {
    label: "Boundary cadence",
    value: "5-minute boundary",
    detail: "Finalized boundary queries must land exactly on the requested boundary.",
  },
  {
    label: "Primary payload format",
    value: "JSON + decimal strings",
    detail: "Timestamps are RFC3339. Monetary values are serialized for precision.",
  },
  {
    label: "Trust surface",
    value: "Optional Ed25519 proof",
    detail: "Finalized boundary responses can be verified with the published public key.",
  },
];

const INTEGRATION_FLOWS = [
  {
    title: "Live UI and dashboards",
    detail: "Boot with GET /v1/price/latest, then subscribe to /ws/price for continuous updates.",
  },
  {
    title: "Boundary-driven consumers",
    detail: "Query GET /v1/price/settlement after the boundary, then verify the attestation when enabled.",
  },
  {
    title: "Historical backfill",
    detail: "Use snapshots for chart ranges and ticks for precise price-change replay.",
  },
];

const RESPONSE_RULES = [
  "All endpoints return application/json except the WebSocket stream.",
  "Error responses use a single error field, for example {\"error\":\"...\"}.",
  "Quality, source counts, and basis values are part of the trust model, not decoration.",
  "When access control is enabled, finalized boundary queries, snapshots, ticks, and WebSocket require starter tier or higher.",
];

const LATEST_EXAMPLE = `$ curl /v1/price/latest?symbol=ETH/USD

{
  "symbol": "ETH/USD",
  "ts": "2026-04-12T10:05:00.123456789Z",
  "price": "71455.33",
  "basis": "median_trade",
  "is_stale": false,
  "is_degraded": false,
  "quality_score": 0.9556,
  "source_count": 4,
  "sources_used": ["binance", "coinbase", "kraken", "okx"]
}`;

const SETTLEMENT_EXAMPLE = `$ curl /v1/price/settlement?ts=2026-04-12T10:05:00Z

{
  "settlement_ts": "2026-04-12T10:05:00Z",
  "symbol": "ETH/USD",
  "price": "71455.33",
  "status": "confirmed",
  "basis": "median_trade",
  "quality_score": 0.9556,
  "source_count": 4,
  "sources_used": ["binance", "coinbase", "kraken", "okx"],
  "finalized_at": "2026-04-12T10:05:01.251Z",
  "source_details": "eyJiaW5hbmNlIjp7InByaWNlIjoiNzE0NTUuMzMiLCJ0cyI6IjIwMjYtMDQtMTJUMTA6MDQ6NTkuOTk5WiJ9fQ==",
  "attestation": {
    "type": "btick.settlement_attestation.v1",
    "algorithm": "ed25519",
    "key_id": "prod-2026-q2",
    "signed_at": "2026-04-12T10:05:05.102Z",
    "payload_hash": "sha256:4f0f7a0ccf5e4b6d3d1aef7f98eac6d17ec815f6f49e83a661c4c0e0f8a8ef6f",
    "signature": "3Zw1W9...",
    "payload": {
      "type": "btick.settlement_attestation.v1",
      "settlement_ts": "2026-04-12T10:05:00Z",
      "symbol": "ETH/USD",
      "price": "71455.33",
      "status": "confirmed",
      "basis": "median_trade",
      "quality_score": "0.9556",
      "source_count": 4,
      "sources_used": ["binance", "coinbase", "kraken", "okx"],
      "finalized_at": "2026-04-12T10:05:01.251Z",
      "source_details_sha256": "sha256:5d962d5c4d37b0d6dd39c4d543af7d6274fc1e90d6f701687ce2f7f4401f4f80"
    }
  }
}`;

const PUBLIC_KEY_EXAMPLE = `$ curl /v1/attestation/public-key

{
  "type": "btick.settlement_attestation.v1",
  "algorithm": "ed25519",
  "key_id": "prod-2026-q2",
  "public_key": "QvP0bD7WkX0vW6fQ4Qh0uV4b7hA6f2nG6rJm0QO4dDU",
  "encoding": "base64url"
}`;

const SNAPSHOTS_EXAMPLE = `$ curl "/v1/price/snapshots?start=2026-04-12T10:00:00Z&end=2026-04-12T10:05:00Z"

[
  {
    "ts_second": "2026-04-12T10:00:00Z",
    "symbol": "ETH/USD",
    "price": "71440.10",
    "basis": "median_trade",
    "quality_score": 0.95,
    "source_count": 4
  },
  ...
]`;

const TICKS_EXAMPLE = `$ curl /v1/price/ticks?limit=5

[
  {
    "ts": "2026-04-12T10:05:00.123Z",
    "symbol": "ETH/USD",
    "price": "71455.33",
    "basis": "median_trade",
    "source_count": 4
  },
  ...
]`;

const WS_EXAMPLE = `const ws = new WebSocket("wss://btick-production.up.railway.app/ws/price")

let lastSeq = 0

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)

  if (msg.seq && lastSeq > 0 && msg.seq > lastSeq + 1) {
    console.warn(\`Missed \${msg.seq - lastSeq - 1} messages\`)
  }
  if (msg.seq) lastSeq = msg.seq

  switch (msg.type) {
    case "welcome":
      console.log("Connected:", msg.message)
      break
    case "latest_price":
      console.log("Price update:", msg.price)
      break
    case "snapshot_1s":
      console.log("Snapshot:", msg.price, "@", msg.ts)
      break
  }
}`;

const WS_SUBSCRIBE_EXAMPLE = `ws.send(JSON.stringify({
  action: "unsubscribe",
  types: ["latest_price", "heartbeat"]
}))

ws.send(JSON.stringify({
  action: "subscribe",
  types: ["source_price", "source_status"]
}))

ws.send(JSON.stringify({
  action: "subscribe",
  types: ["latest_price"],
  symbols: ["ETH/USD"]
}))`;

const HEALTH_EXAMPLE = `$ curl /v1/health

{
  "status": "ok",
  "timestamp": "2026-04-12T10:05:00.123Z",
  "dependencies": { "database": { "ready": true } },
  "latest_price": "71455.33",
  "source_count": 4
}`;

const FEEDS_EXAMPLE = `$ curl /v1/health/feeds

[
  {
    "source": "binance",
    "conn_state": "connected",
    "last_trade_ts": "2026-04-12T10:05:00.100Z",
    "median_lag_ms": 45,
    "stale": false
  },
  ...
]`;

const ALL_ENDPOINTS = [
  {
    method: "GET",
    path: "/v1/price/latest",
    access: "Public",
    desc: "Current canonical price",
    notes: "Fastest read path, served from memory.",
  },
  {
    method: "GET",
    path: "/v1/price/settlement",
    access: "Starter",
    desc: "Finalized boundary price at a 5-minute interval",
    notes: "Use for downstream reconciliation, attestable cutoffs, and audits.",
  },
  {
    method: "GET",
    path: "/v1/attestation/public-key",
    access: "Public",
    desc: "Active attestation verification key",
    notes: "Available only when attestations are enabled.",
  },
  {
    method: "GET",
    path: "/v1/price/snapshots",
    access: "Starter",
    desc: "Historical 1-second snapshots",
    notes: "Best fit for charts, candles, and backfill.",
  },
  {
    method: "GET",
    path: "/v1/price/ticks",
    access: "Starter",
    desc: "Recent canonical price changes",
    notes: "Useful for precise replay of movement rather than fixed intervals.",
  },
  {
    method: "GET",
    path: "/v1/price/raw",
    access: "Pro tier",
    desc: "Underlying exchange data",
    notes: "Audit/debug surface for venue-level investigation.",
  },
  {
    method: "WS",
    path: "/ws/price",
    access: "Starter",
    desc: "Live stream with sequencing",
    notes: "Subscribe once and keep UI state hot.",
  },
  {
    method: "GET",
    path: "/v1/health",
    access: "Public",
    desc: "Instance health",
    notes: "Top-level readiness and latest-price status.",
  },
  {
    method: "GET",
    path: "/v1/health/feeds",
    access: "Public",
    desc: "Per-source operational status",
    notes: "Track venue lag, connection state, and staleness.",
  },
  {
    method: "GET",
    path: "/v1/symbols",
    access: "Public",
    desc: "Configured symbols",
    notes: "Discover canonical products available on this instance.",
  },
  {
    method: "GET",
    path: "/metrics",
    access: "Public",
    desc: "Prometheus metrics",
    notes: "Scrape-friendly runtime metrics for ops.",
  },
];

type ProofState = {
  kind: "idle" | "loading" | "verified" | "invalid" | "missing";
  message: string;
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`${styles.method} ${method === "WS" ? styles.methodWs : styles.methodGet}`}
    >
      {method}
    </span>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className={styles.codeBlock}>
      <code dangerouslySetInnerHTML={{ __html: highlight(children) }} />
    </pre>
  );
}

function SectionFrame({
  id,
  eyebrow,
  title,
  desc,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionLead}>
        <div className={styles.sectionEyebrow}>{eyebrow}</div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <p className={styles.sectionDesc}>{desc}</p>
      </div>
      {children}
    </section>
  );
}

function EndpointHeader({
  method,
  path,
  audience,
}: {
  method: string;
  path: string;
  audience: string;
}) {
  return (
    <div className={styles.endpointCard}>
      <div className={styles.endpointTop}>
        <div className={styles.endpointRow}>
          <MethodBadge method={method} />
          <code className={styles.path}>{path}</code>
        </div>
        <span className={styles.audienceBadge}>{audience}</span>
      </div>
    </div>
  );
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string; detail: string }>;
}) {
  return (
    <div className={styles.detailGrid}>
      {items.map((item) => (
        <div key={item.label} className={styles.detailCard}>
          <div className={styles.detailLabel}>{item.label}</div>
          <div className={styles.detailValue}>{item.value}</div>
          <div className={styles.detailText}>{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

function FieldTable({
  rows,
}: {
  rows: Array<{ field: string; type: string; notes: string }>;
}) {
  return (
    <table className={styles.fieldTable}>
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field}>
            <td>{row.field}</td>
            <td>{row.type}</td>
            <td>{row.notes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OverviewSection() {
  return (
    <SectionFrame
      id="overview"
      eyebrow="Overview"
      title="Integration model"
      desc="btick exposes one fast live surface, one finalized boundary surface, and one replay surface. Use them intentionally instead of treating every route as interchangeable price data."
    >
      <DetailGrid items={PLATFORM_CARDS} />

      <div className={styles.panelGrid}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Recommended flows</div>
          <div className={styles.flowList}>
            {INTEGRATION_FLOWS.map((flow, index) => (
              <div key={flow.title} className={styles.flowItem}>
                <span className={styles.flowIndex}>{index + 1}</span>
                <div>
                  <div className={styles.flowTitle}>{flow.title}</div>
                  <div className={styles.flowText}>{flow.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelTitle}>Response conventions</div>
          <div className={styles.ruleList}>
            {RESPONSE_RULES.map((rule) => (
              <div key={rule} className={styles.ruleItem}>
                {rule}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionFrame>
  );
}

function LatestSection() {
  return (
    <SectionFrame
      id="latest"
      eyebrow="REST"
      title="Latest price"
      desc="Use this route for app chrome, dashboards, and live price displays where the freshest in-memory canonical value matters more than finalized boundary semantics."
    >
      <EndpointHeader method="GET" path="/v1/price/latest" audience="Public" />

      <DetailGrid
        items={[
          {
            label: "Backed by",
            value: "Memory",
            detail: "No historical query required. Lowest latency surface in the system.",
          },
          {
            label: "Timing model",
            value: "Arrival-time latest",
            detail: "Optimized for freshness rather than sealed event-time boundary finalization.",
          },
          {
            label: "Do not use for",
            value: "Finalized boundary decisions",
            detail: "Boundary and audit flows should query the dedicated settlement route.",
          },
        ]}
      />

      <div className={styles.params}>
        <div className={styles.paramsLabel}>Query parameters</div>
        <div className={styles.param}>
          <code className={styles.paramName}>symbol</code>
          <span className={styles.paramOptional}>optional</span>
          <span className={styles.paramDesc}>
            Canonical symbol such as ETH/USD. Defaults to the first configured symbol.
          </span>
        </div>
      </div>

      <Code>{LATEST_EXAMPLE}</Code>

      <div className={styles.sectionSubtitle}>Key fields</div>
      <FieldTable
        rows={[
          { field: "ts", type: "RFC3339 timestamp", notes: "Server-side observation time for the latest state." },
          { field: "basis", type: "enum", notes: "Why the canonical price resolved the way it did." },
          { field: "quality_score", type: "float", notes: "Quality signal from 0 to 1. Lower values indicate weaker confidence." },
          { field: "source_count", type: "integer", notes: "How many sources contributed to the live canonical price." },
        ]}
      />

      <div className={styles.errors}>
        <span className={styles.errorCode}>503</span> no data available yet
      </div>
    </SectionFrame>
  );
}

function SettlementSection() {
  const [inputTS, setInputTS] = useState(defaultSettlementTimestamp);
  const [requestedTS, setRequestedTS] = useState(defaultSettlementTimestamp);
  const [tamperDemo, setTamperDemo] = useState(false);
  const [proofState, setProofState] = useState<ProofState>({
    kind: "loading",
    message: "Fetching finalized boundary proof…",
  });

  const settlementQuery = useQuery(settlementPriceOptions(requestedTS));
  const displayedSettlement = settlementQuery.data
    ? maybeTamperSettlement(settlementQuery.data, tamperDemo)
    : undefined;
  const publicKeyQuery = useQuery({
    ...attestationPublicKeyOptions(),
    enabled: Boolean(settlementQuery.data?.attestation),
  });

  useEffect(() => {
    let cancelled = false;

    async function runVerification() {
      if (settlementQuery.isLoading) {
        setProofState({ kind: "loading", message: "Fetching finalized boundary proof…" });
        return;
      }
      if (settlementQuery.error) {
        setProofState({ kind: "invalid", message: getErrorMessage(settlementQuery.error) });
        return;
      }
      if (!displayedSettlement) {
        setProofState({ kind: "idle", message: "Choose a finalized boundary timestamp to verify." });
        return;
      }
      if (!displayedSettlement.attestation) {
        setProofState({ kind: "missing", message: "This finalized boundary response does not include an attestation." });
        return;
      }
      if (publicKeyQuery.isLoading) {
        setProofState({ kind: "loading", message: "Loading active verification key…" });
        return;
      }
      if (publicKeyQuery.error) {
        setProofState({ kind: "invalid", message: getErrorMessage(publicKeyQuery.error) });
        return;
      }
      if (!publicKeyQuery.data) {
        setProofState({ kind: "invalid", message: "Verification key was not returned by the server." });
        return;
      }

      setProofState({
        kind: "loading",
        message: tamperDemo
          ? "Re-running verifier against a tampered response…"
          : "Checking signature, hashes, and outer response fields…",
      });

      try {
        await verifySettlementResponseAttestation(displayedSettlement, publicKeyQuery.data);
        if (!cancelled) {
          setProofState({
            kind: "verified",
            message: `Verified with key ${publicKeyQuery.data.key_id}. Signature, payload hash, and source_details hash all match.`,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setProofState({ kind: "invalid", message: getErrorMessage(error) });
        }
      }
    }

    void runVerification();
    return () => {
      cancelled = true;
    };
  }, [
    displayedSettlement,
    publicKeyQuery.data,
    publicKeyQuery.error,
    publicKeyQuery.isLoading,
    settlementQuery.data,
    settlementQuery.error,
    settlementQuery.isLoading,
    tamperDemo,
  ]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestedTS(inputTS.trim());
  }

  const proofBadgeClass = [
    styles.proofBadge,
    proofState.kind === "verified"
      ? styles.proofBadgeVerified
      : proofState.kind === "invalid"
        ? styles.proofBadgeInvalid
        : proofState.kind === "missing"
          ? styles.proofBadgeMissing
          : styles.proofBadgePending,
  ].join(" ");

  return (
    <SectionFrame
      id="settlement"
      eyebrow="Resolution"
      title="Finalized boundary endpoint"
      desc="This is the finalized boundary route behind the legacy settlement path. It is intentionally separate from the low-latency latest-price fast path so downstream systems can consume sealed, attestable cutoffs."
    >
      <EndpointHeader method="GET" path="/v1/price/settlement" audience="Starter" />

      <DetailGrid
        items={[
          {
            label: "Boundary",
            value: "Exact 5-minute RFC3339",
            detail: "Only timestamps aligned to the 5-minute close are valid.",
          },
          {
            label: "Finalization",
            value: "Wait a few seconds",
            detail: "Request after the boundary plus finalization delay to avoid 425 responses.",
          },
          {
            label: "Trust surface",
            value: "Status + proof",
            detail: "Use status, source_count, and optional attestation together before accepting a finalized boundary result.",
          },
        ]}
      />

      <div className={styles.params}>
        <div className={styles.paramsLabel}>Query parameters</div>
        <div className={styles.param}>
          <code className={styles.paramName}>ts</code>
          <span className={styles.paramRequired}>required</span>
          <span className={styles.paramDesc}>
            RFC3339 timestamp on a 5-minute boundary, for example 2026-04-12T10:05:00Z.
          </span>
        </div>
      </div>

      <Code>{SETTLEMENT_EXAMPLE}</Code>

      <div className={styles.sectionSubtitle}>Key fields</div>
      <FieldTable
        rows={[
          { field: "status", type: "confirmed | degraded | stale", notes: "Operational confidence for downstream boundary-handling logic." },
          { field: "finalized_at", type: "RFC3339 timestamp", notes: "When btick sealed and finalized the response payload." },
          { field: "source_details", type: "base64 string", notes: "Audit payload containing the per-source details behind the finalized boundary response." },
          { field: "attestation", type: "object | omitted", notes: "Present only when boundary-response signing is enabled on the instance." },
        ]}
      />

      <div className={styles.subEndpoint}>
        <MethodBadge method="GET" />
        <code className={styles.path}>/v1/attestation/public-key</code>
        <span className={styles.inlineBadge}>Public key discovery</span>
      </div>
      <p className={styles.sectionDesc}>
        Fetch the active Ed25519 verification key before validating signed finalized boundary responses in Go, TypeScript, or any external verifier.
      </p>
      <Code>{PUBLIC_KEY_EXAMPLE}</Code>

      <div className={styles.proofPanel}>
        <div className={styles.proofHeader}>
          <div>
            <div className={styles.sectionSubtitle}>Live proof check</div>
            <p className={styles.sectionDesc}>
              This page runs the browser verifier from <code>@/api/attestation</code> against a real finalized boundary response and the published key, then shows how tampering is detected.
            </p>
          </div>
          <span className={proofBadgeClass}>{proofLabel(proofState.kind)}</span>
        </div>

        <form className={styles.proofControls} onSubmit={handleSubmit}>
          <label className={styles.proofField}>
            <span className={styles.paramsLabel}>Boundary timestamp</span>
            <input
              className={styles.proofInput}
              type="text"
              value={inputTS}
              onChange={(event) => setInputTS(event.target.value)}
              spellCheck={false}
              placeholder="2026-04-12T10:05:00Z"
            />
          </label>
          <button className={styles.proofButton} type="submit">
            Verify live proof
          </button>
        </form>

        <label className={styles.proofToggle}>
          <input
            type="checkbox"
            checked={tamperDemo}
            onChange={(event) => setTamperDemo(event.target.checked)}
          />
          <span>Simulate transport tampering by mutating the outer response price after fetch.</span>
        </label>

        <div className={styles.proofMessage}>{proofState.message}</div>

        <div className={styles.proofMetaGrid}>
          <div className={styles.proofMetaCard}>
            <div className={styles.proofMetaLabel}>Requested ts</div>
            <div className={styles.proofMetaValue}>{requestedTS}</div>
          </div>
          <div className={styles.proofMetaCard}>
            <div className={styles.proofMetaLabel}>Key id</div>
            <div className={styles.proofMetaValue}>
              {displayedSettlement?.attestation?.key_id ?? publicKeyQuery.data?.key_id ?? "-"}
            </div>
          </div>
          <div className={styles.proofMetaCard}>
            <div className={styles.proofMetaLabel}>Signature algorithm</div>
            <div className={styles.proofMetaValue}>
              {displayedSettlement?.attestation?.algorithm ?? publicKeyQuery.data?.algorithm ?? "-"}
            </div>
          </div>
          <div className={styles.proofMetaCard}>
            <div className={styles.proofMetaLabel}>Signed at</div>
            <div className={styles.proofMetaValue}>
              {displayedSettlement?.attestation?.signed_at ?? "-"}
            </div>
          </div>
        </div>

        <div className={styles.proofJsonGrid}>
          <div>
            <div className={styles.proofJsonLabel}>Finalized boundary response under verification</div>
            <Code>
              {displayedSettlement
                ? JSON.stringify(displayedSettlement, null, 2)
                : "Load a finalized boundary response to inspect the signed payload."}
            </Code>
          </div>
          <div>
            <div className={styles.proofJsonLabel}>Active public key</div>
            <Code>
              {publicKeyQuery.data
                ? JSON.stringify(publicKeyQuery.data, null, 2)
                : "The key endpoint is queried only when the finalized boundary response includes an attestation."}
            </Code>
          </div>
        </div>
      </div>

      <div className={styles.sectionSubtitle}>Boundary status model</div>
      <table className={styles.statusTable}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
            <th>Recommended action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>confirmed</td>
            <td>Multi-source, high-quality finalized boundary price</td>
            <td>Safe for normal automated downstream acceptance</td>
          </tr>
          <tr>
            <td>degraded</td>
            <td>Reduced source coverage or weaker quality</td>
            <td>Review before automatically consuming downstream</td>
          </tr>
          <tr>
            <td>stale</td>
            <td>No sufficiently fresh venue state at the requested boundary</td>
            <td>Escalate to manual handling or a stricter fallback policy</td>
          </tr>
        </tbody>
      </table>

      <div className={styles.errors}>
        <span className={styles.errorCode}>400</span> invalid ts format{" · "}
        <span className={styles.errorCode}>400</span> not on 5-minute boundary{" · "}
        <span className={styles.errorCode}>425</span> settlement not yet finalized{" · "}
        <span className={styles.errorCode}>404</span> no data for timestamp
      </div>
    </SectionFrame>
  );
}

function SnapshotsSection() {
  return (
    <SectionFrame
      id="snapshots"
      eyebrow="History"
      title="Snapshots and ticks"
      desc="Use these database-backed routes when you need a replayable view of price evolution rather than only the current latest state."
    >
      <EndpointHeader method="GET" path="/v1/price/snapshots" audience="Starter" />

      <DetailGrid
        items={[
          {
            label: "Granularity",
            value: "1-second snapshots",
            detail: "Stable fixed-interval history for charts and historical analysis.",
          },
          {
            label: "Backed by",
            value: "Database",
            detail: "This is a historical query path and depends on storage availability.",
          },
          {
            label: "Best use",
            value: "Chart backfill",
            detail: "Seed chart state first, then append live snapshots from WebSocket.",
          },
        ]}
      />

      <div className={styles.params}>
        <div className={styles.paramsLabel}>Query parameters</div>
        <div className={styles.param}>
          <code className={styles.paramName}>start</code>
          <span className={styles.paramRequired}>required</span>
          <span className={styles.paramDesc}>Range start in RFC3339 format.</span>
        </div>
        <div className={styles.param}>
          <code className={styles.paramName}>end</code>
          <span className={styles.paramOptional}>optional</span>
          <span className={styles.paramDesc}>Range end in RFC3339 format. Defaults to now.</span>
        </div>
      </div>

      <Code>{SNAPSHOTS_EXAMPLE}</Code>

      <div className={styles.sectionSubtitle}>Snapshot fields</div>
      <FieldTable
        rows={[
          { field: "ts_second", type: "RFC3339 timestamp", notes: "The sealed one-second bucket represented by the row." },
          { field: "price", type: "decimal string", notes: "Canonical price for that second." },
          { field: "quality_score", type: "float", notes: "Confidence proxy for that particular second." },
          { field: "source_count", type: "integer", notes: "How many sources participated in the final snapshot." },
        ]}
      />

      <div className={styles.subEndpoint}>
        <MethodBadge method="GET" />
        <code className={styles.path}>/v1/price/ticks</code>
        <span className={styles.inlineBadge}>Change stream replay</span>
      </div>
      <p className={styles.sectionDesc}>
        Ticks are sparse and only emitted when the canonical price changes. Use them when change precision matters more than evenly spaced intervals.
      </p>

      <div className={styles.params}>
        <div className={styles.paramsLabel}>Query parameters</div>
        <div className={styles.param}>
          <code className={styles.paramName}>limit</code>
          <span className={styles.paramOptional}>optional</span>
          <span className={styles.paramDesc}>Number of rows to return. Default 100, maximum 1000.</span>
        </div>
      </div>

      <Code>{TICKS_EXAMPLE}</Code>

      <div className={styles.errors}>
        <span className={styles.errorCode}>503</span> database not available
      </div>
    </SectionFrame>
  );
}

function WebSocketSection() {
  return (
    <SectionFrame
      id="websocket"
      eyebrow="Streaming"
      title="Real-time WebSocket"
      desc="The WebSocket stream is the primary live-delivery transport for frontends. It sends a welcome frame, current state, then incremental broadcast messages with sequence numbers for gap detection."
    >
      <EndpointHeader method="WS" path="/ws/price" audience="Starter" />

      <DetailGrid
        items={[
          {
            label: "Delivery model",
            value: "Sequenced broadcast",
            detail: "Use seq gaps to detect dropped messages or reconnect boundaries.",
          },
          {
            label: "Default feed",
            value: "latest_price + snapshot_1s",
            detail: "Source-level streams are opt-in and symbol filters are supported.",
          },
          {
            label: "Ideal use",
            value: "Keep UI hot",
            detail: "Use this to avoid polling while preserving immediate user feedback.",
          },
        ]}
      />

      <div className={styles.sectionSubtitle}>Connect</div>
      <Code>{WS_EXAMPLE}</Code>

      <div className={styles.sectionSubtitle}>Message types</div>
      <table className={styles.msgTable}>
        <thead>
          <tr>
            <th>Type</th>
            <th>Direction</th>
            <th>Key fields</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>welcome</td>
            <td>server → client</td>
            <td>message, protocol identifier</td>
          </tr>
          <tr>
            <td>latest_price</td>
            <td>server → client</td>
            <td>price, basis, quality_score, source_count</td>
          </tr>
          <tr>
            <td>snapshot_1s</td>
            <td>server → client</td>
            <td>price, basis, ts</td>
          </tr>
          <tr>
            <td>heartbeat</td>
            <td>server → client</td>
            <td>seq, ts</td>
          </tr>
          <tr>
            <td>source_price</td>
            <td>server → client</td>
            <td>source, price</td>
          </tr>
          <tr>
            <td>source_status</td>
            <td>server → client</td>
            <td>source, state</td>
          </tr>
          <tr>
            <td>subscribe</td>
            <td>client → server</td>
            <td>types, symbols</td>
          </tr>
          <tr>
            <td>unsubscribe</td>
            <td>client → server</td>
            <td>types, symbols</td>
          </tr>
        </tbody>
      </table>

      <div className={styles.sectionSubtitle}>Filtering and symbol targeting</div>
      <p className={styles.sectionDesc}>
        By default, clients receive <code>latest_price</code>, <code>snapshot_1s</code>, and <code>heartbeat</code>. Source-level types are opt-in. Unknown types and symbols are ignored for forward compatibility.
      </p>
      <Code>{WS_SUBSCRIBE_EXAMPLE}</Code>
    </SectionFrame>
  );
}

function HealthSection() {
  return (
    <SectionFrame
      id="health"
      eyebrow="Operations"
      title="Health and feed inspection"
      desc="These routes support platform monitoring, not trading logic. Use them to understand whether the instance and underlying venue feeds are healthy."
    >
      <EndpointHeader method="GET" path="/v1/health" audience="Public" />

      <DetailGrid
        items={[
          {
            label: "Top-level status",
            value: "ok / degraded / stale / no_data",
            detail: "Summarizes the operational state of the current canonical feed.",
          },
          {
            label: "Dependency signal",
            value: "Database readiness",
            detail: "Useful for readiness checks during deploys and incident response.",
          },
          {
            label: "Operational use",
            value: "Monitoring only",
            detail: "Do not derive finalized boundary decisions from health routes.",
          },
        ]}
      />

      <Code>{HEALTH_EXAMPLE}</Code>

      <div className={styles.sectionSubtitle}>Status meanings</div>
      <table className={styles.statusTable}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ok</td>
            <td>All systems healthy and price data fresh.</td>
          </tr>
          <tr>
            <td>degraded</td>
            <td>Fewer than minimum healthy sources are contributing.</td>
          </tr>
          <tr>
            <td>stale</td>
            <td>No sufficiently fresh data; carry-forward may be active.</td>
          </tr>
          <tr>
            <td>no_data</td>
            <td>The instance has not produced a canonical price yet.</td>
          </tr>
        </tbody>
      </table>

      <div className={styles.subEndpoint}>
        <MethodBadge method="GET" />
        <code className={styles.path}>/v1/health/feeds</code>
        <span className={styles.inlineBadge}>Venue diagnostics</span>
      </div>
      <p className={styles.sectionDesc}>
        Feed health returns per-source diagnostics, including connection state, median lag, freshness, and last trade activity.
      </p>
      <Code>{FEEDS_EXAMPLE}</Code>

      <div className={styles.sectionSubtitle}>Feed fields</div>
      <FieldTable
        rows={[
          { field: "conn_state", type: "enum", notes: "Connection lifecycle state for the source adapter." },
          { field: "last_trade_ts", type: "RFC3339 timestamp", notes: "Most recent observed trade from that venue." },
          { field: "median_lag_ms", type: "integer", notes: "Median ingest lag for the source over the sampled period." },
          { field: "stale", type: "boolean", notes: "Whether the source is currently outside the freshness window." },
        ]}
      />
    </SectionFrame>
  );
}

function EndpointsSection() {
  return (
    <SectionFrame
      id="endpoints"
      eyebrow="Reference"
      title="Endpoint index"
      desc="This is the short-form inventory for teams that already know the btick model and just need route, access, and purpose at a glance."
    >
      <table className={styles.summaryTable}>
        <thead>
          <tr>
            <th>Method</th>
            <th>Path</th>
            <th>Access</th>
            <th>Use</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {ALL_ENDPOINTS.map((endpoint) => (
            <tr key={endpoint.path}>
              <td>
                <MethodBadge method={endpoint.method} />
              </td>
              <td>{endpoint.path}</td>
              <td>{endpoint.access}</td>
              <td>{endpoint.desc}</td>
              <td>{endpoint.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionFrame>
  );
}

function defaultSettlementTimestamp() {
  const now = new Date(Date.now() - 10 * 60 * 1000);
  const truncated = new Date(now);
  truncated.setUTCSeconds(0, 0);
  truncated.setUTCMinutes(Math.floor(truncated.getUTCMinutes() / 5) * 5);
  return truncated.toISOString().replace(/\.000Z$/, "Z");
}

function maybeTamperSettlement(settlement: SettlementPrice, tamperDemo: boolean): SettlementPrice {
  if (!tamperDemo) {
    return settlement;
  }
  return {
    ...settlement,
    price: nudgePrice(settlement.price),
  };
}

function nudgePrice(price: string) {
  const numeric = Number.parseFloat(price);
  if (!Number.isFinite(numeric)) {
    return `${price}-tampered`;
  }
  const decimalPlaces = price.includes(".") ? price.split(".")[1].length : 0;
  const increment = decimalPlaces > 0 ? 10 ** -decimalPlaces : 1;
  return (numeric + increment).toFixed(decimalPlaces);
}

function proofLabel(kind: ProofState["kind"]) {
  switch (kind) {
    case "verified":
      return "verified";
    case "invalid":
      return "invalid";
    case "missing":
      return "no proof";
    case "loading":
      return "checking";
    default:
      return "idle";
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Verification failed";
}

export function ApiPage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.heroEyebrow}>Developer Reference</p>
        <h1 className={styles.title}>API Reference</h1>
        <p className={styles.desc}>
          Integration guide for btick price delivery, settlement resolution, historical replay, and operational verification.
        </p>
        <div className={styles.baseCard}>
          <span className={styles.baseLabel}>Base URL</span>
          <code className={styles.baseUrl}>https://btick-production.up.railway.app</code>
          <p className={styles.transport}>
            JSON over HTTPS · RFC3339 timestamps · CORS enabled · WebSocket at <code>/ws/price</code>
          </p>
        </div>
      </header>

      <OverviewSection />
      <LatestSection />
      <SettlementSection />
      <SnapshotsSection />
      <WebSocketSection />
      <HealthSection />
      <EndpointsSection />
    </div>
  );
}