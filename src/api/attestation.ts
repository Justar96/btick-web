import type { components } from "./schema";

export const settlementAttestationType = "btick.settlement_attestation.v1";

export type SettlementPrice = components["schemas"]["SettlementPrice"];
export type SettlementAttestation = components["schemas"]["SettlementAttestation"];
export type SettlementAttestationPayload = components["schemas"]["SettlementAttestationPayload"];
export type AttestationPublicKey = components["schemas"]["AttestationPublicKey"];

export async function verifySettlementResponseAttestation(
  response: SettlementPrice,
  publicKey: AttestationPublicKey,
): Promise<void> {
  if (!response.attestation) {
    throw new Error("Settlement response is missing attestation");
  }

  await verifySettlementAttestation(response.attestation, publicKey);
  verifyOuterResponse(response, response.attestation.payload);
  await verifySourceDetails(response.source_details, response.attestation.payload.source_details_sha256);
}

export async function verifySettlementAttestation(
  attestation: SettlementAttestation,
  publicKey: AttestationPublicKey,
): Promise<void> {
  verifyMetadata(attestation, publicKey);
  const subtle = getSubtleCrypto();

  const payloadJSON = canonicalPayloadBytes(attestation.payload);
  const payloadHash = `sha256:${toHex(await subtle.digest("SHA-256", payloadJSON))}`;
  if (payloadHash !== attestation.payload_hash) {
    throw new Error(`Attestation payload hash mismatch: expected ${attestation.payload_hash}, got ${payloadHash}`);
  }

  const key = await subtle.importKey(
    "raw",
    decodeBase64Url(publicKey.public_key),
    "Ed25519",
    false,
    ["verify"],
  );

  const verified = await subtle.verify(
    "Ed25519",
    key,
    decodeBase64Url(attestation.signature),
    payloadJSON,
  );

  if (!verified) {
    throw new Error("Attestation signature verification failed");
  }
}

function verifyMetadata(attestation: SettlementAttestation, publicKey: AttestationPublicKey) {
  if (attestation.type !== settlementAttestationType) {
    throw new Error(`Unsupported attestation type ${attestation.type}`);
  }
  if (attestation.payload.type !== settlementAttestationType) {
    throw new Error(`Unsupported attested payload type ${attestation.payload.type}`);
  }
  if (attestation.algorithm !== "ed25519") {
    throw new Error(`Unsupported attestation algorithm ${attestation.algorithm}`);
  }
  if (publicKey.type !== settlementAttestationType) {
    throw new Error(`Unsupported public key type ${publicKey.type}`);
  }
  if (publicKey.algorithm !== "ed25519") {
    throw new Error(`Unsupported public key algorithm ${publicKey.algorithm}`);
  }
  if (publicKey.encoding !== "base64url") {
    throw new Error(`Unsupported public key encoding ${publicKey.encoding}`);
  }
  if (attestation.key_id !== publicKey.key_id) {
    throw new Error(`Attestation key id ${attestation.key_id} does not match public key ${publicKey.key_id}`);
  }
}

function verifyOuterResponse(response: SettlementPrice, payload: SettlementAttestationPayload) {
  if (response.settlement_ts !== payload.settlement_ts) {
    throw new Error(`settlement_ts mismatch: response=${response.settlement_ts} payload=${payload.settlement_ts}`);
  }
  if (response.symbol !== payload.symbol) {
    throw new Error(`symbol mismatch: response=${response.symbol} payload=${payload.symbol}`);
  }
  if (response.price !== payload.price) {
    throw new Error(`price mismatch: response=${response.price} payload=${payload.price}`);
  }
  if (response.status !== payload.status) {
    throw new Error(`status mismatch: response=${response.status} payload=${payload.status}`);
  }
  if (response.basis !== payload.basis) {
    throw new Error(`basis mismatch: response=${response.basis} payload=${payload.basis}`);
  }
  if (formatQualityScore(response.quality_score) !== payload.quality_score) {
    throw new Error(
      `quality_score mismatch: response=${formatQualityScore(response.quality_score)} payload=${payload.quality_score}`,
    );
  }
  if (response.source_count !== payload.source_count) {
    throw new Error(`source_count mismatch: response=${response.source_count} payload=${payload.source_count}`);
  }
  if (!sameStringSet(response.sources_used ?? [], payload.sources_used)) {
    throw new Error("sources_used mismatch between response and attested payload");
  }
  if (response.finalized_at !== payload.finalized_at) {
    throw new Error(`finalized_at mismatch: response=${response.finalized_at} payload=${payload.finalized_at}`);
  }
}

async function verifySourceDetails(sourceDetails: string | undefined, expectedHash: string) {
  const sourceBytes = decodeBase64(sourceDetails ?? "");
  const actualHash = `sha256:${toHex(await getSubtleCrypto().digest("SHA-256", sourceBytes))}`;
  if (actualHash !== expectedHash) {
    throw new Error(`source_details hash mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
}

function getSubtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle API is not available in this browser");
  }
  return subtle;
}

function canonicalPayloadBytes(payload: SettlementAttestationPayload) {
  const normalizedPayload = {
    type: payload.type,
    settlement_ts: payload.settlement_ts,
    symbol: payload.symbol,
    price: payload.price,
    status: payload.status,
    basis: payload.basis,
    quality_score: payload.quality_score,
    source_count: payload.source_count,
    sources_used: [...payload.sources_used].sort(),
    finalized_at: payload.finalized_at,
    source_details_sha256: payload.source_details_sha256,
  };
  return new TextEncoder().encode(JSON.stringify(normalizedPayload));
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return decodeBase64(padded);
}

function decodeBase64(input: string) {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function formatQualityScore(value: number | undefined) {
  if (value === undefined) {
    return "";
  }
  return Number(value).toString();
}