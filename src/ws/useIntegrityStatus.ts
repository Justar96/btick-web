import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { verifySettlementResponseAttestation } from "@/api/attestation";
import { attestationPublicKeyOptions, feedHealthOptions, settlementPriceOptions } from "@/api/queries";
import { useWSConnected } from "@/ws/context";

type Tone = "ok" | "warn" | "muted";

export type IntegrityStatus = {
  stream: string;
  streamTone: Tone;
  feeds: string;
  feedsTone: Tone;
  settlement: string;
  settlementTone: Tone;
};

function latestFinalizedSettlementTS(): string {
  const now = new Date(Date.now() - 10_000);
  now.setUTCSeconds(0, 0);
  now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 5) * 5);
  return now.toISOString().replace(/\.000Z$/, "Z");
}

export function useIntegrityStatus(): IntegrityStatus {
  const wsConnected = useWSConnected();
  const { data: feedHealth } = useQuery(feedHealthOptions());

  const [settlementTS, setSettlementTS] = useState(() => latestFinalizedSettlementTS());
  useEffect(() => {
    const id = setInterval(() => setSettlementTS(latestFinalizedSettlementTS()), 300_000);
    return () => clearInterval(id);
  }, []);

  const settlementQuery = useQuery(settlementPriceOptions(settlementTS));
  const publicKeyQuery = useQuery({
    ...attestationPublicKeyOptions(),
    enabled: Boolean(settlementQuery.data?.attestation),
  });

  const [proofState, setProofState] = useState<{ tone: Tone; value: string }>({
    tone: "muted",
    value: "Checking",
  });

  useEffect(() => {
    let cancelled = false;

    async function verifyProof() {
      if (settlementQuery.isLoading) {
        setProofState({ tone: "muted", value: "Checking" });
        return;
      }
      if (settlementQuery.error) {
        setProofState({ tone: "warn", value: "Unavailable" });
        return;
      }
      if (!settlementQuery.data?.attestation) {
        setProofState({ tone: "muted", value: "Unsigned" });
        return;
      }
      if (publicKeyQuery.isLoading) {
        setProofState({ tone: "muted", value: "Checking" });
        return;
      }
      if (publicKeyQuery.error || !publicKeyQuery.data) {
        setProofState({ tone: "warn", value: "Unavailable" });
        return;
      }
      try {
        await verifySettlementResponseAttestation(settlementQuery.data, publicKeyQuery.data);
        if (!cancelled) setProofState({ tone: "ok", value: "Verified" });
      } catch {
        if (!cancelled) setProofState({ tone: "warn", value: "Invalid" });
      }
    }

    void verifyProof();
    return () => {
      cancelled = true;
    };
  }, [
    publicKeyQuery.data,
    publicKeyQuery.error,
    publicKeyQuery.isLoading,
    settlementQuery.data,
    settlementQuery.error,
    settlementQuery.isLoading,
  ]);

  const feeds = feedHealth ?? [];
  const connectedFeeds = feeds.filter((f) => f.conn_state === "connected").length;
  const staleFeeds = feeds.filter((f) => f.stale).length;

  return {
    stream: wsConnected ? "Live" : "Reconnecting",
    streamTone: wsConnected ? "ok" : "muted",
    feeds: feeds.length > 0 ? `${connectedFeeds}/${feeds.length}` : "—",
    feedsTone: feeds.length === 0 ? "muted" : staleFeeds > 0 ? "warn" : "ok",
    settlement: proofState.value,
    settlementTone: proofState.tone,
  };
}
