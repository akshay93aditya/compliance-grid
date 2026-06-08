import type {
  PublishInstrumentRow,
  PublishObligationRow,
  PublishSourceRow,
} from '../db/publish';

// Phase 3.3 (D51) — federation payload assembly. Pure functions that take
// the rows loaded from the local CKG and produce the JSONL bytes that
// `cg publish` writes into the companion-repo workspace.
//
// Each obligation, instrument, and source becomes one line; the file path
// encodes the bucket coordinate. The merge step (when a file already
// exists in the workspace from a prior publish) dedupes by id so a
// downstream operator's `cg pull` sees one row per canonical entity.

export interface PayloadHeader {
  extracted_by: string;
  payload_version: string;
}

export interface PayloadBucket {
  jurisdiction: string;
  domain: string;
  obligations: PublishObligationRow[];
  instruments: PublishInstrumentRow[];
  sources: PublishSourceRow[];
}

export interface PayloadSummary {
  buckets: number;
  obligations: number;
  instruments: number;
  sources: number;
  jurisdictions: string[];
  domains: string[];
  confidence: {
    min: number;
    max: number;
    avg: number;
  };
  source_urls: string[];
}

export const PAYLOAD_VERSION = '1';

// Partitions the loaded rows into per-(jurisdiction, domain) buckets so
// each one writes to its own file path in the companion repo. Obligations
// determine the bucket; instruments and sources tag along, deduped per
// bucket and (eventually) across buckets.
export function bucketize(
  obligations: PublishObligationRow[],
  instruments: PublishInstrumentRow[],
  sources: PublishSourceRow[]
): PayloadBucket[] {
  const byBucket = new Map<string, PublishObligationRow[]>();
  for (const o of obligations) {
    const k = `${o.bucket_jurisdiction}/${o.bucket_domain}`;
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(o);
  }

  const instrumentsById = new Map(instruments.map((i) => [i.id, i]));
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  const buckets: PayloadBucket[] = [];
  for (const [bucket, obs] of byBucket.entries()) {
    const [jurisdiction, domain] = bucket.split('/');
    const instrumentIds = new Set(obs.map((o) => o.instrument_id));
    const sourceIds = new Set<string>();
    for (const o of obs) for (const r of o.source_refs) sourceIds.add(r.source_id);

    buckets.push({
      jurisdiction: jurisdiction!,
      domain: domain!,
      obligations: obs,
      instruments: [...instrumentIds]
        .map((id) => instrumentsById.get(id))
        .filter((x): x is PublishInstrumentRow => x !== undefined),
      sources: [...sourceIds]
        .map((id) => sourcesById.get(id))
        .filter((x): x is PublishSourceRow => x !== undefined),
    });
  }
  return buckets.sort(
    (a, b) =>
      a.jurisdiction.localeCompare(b.jurisdiction) ||
      a.domain.localeCompare(b.domain)
  );
}

// Merges new rows into existing JSONL content. Receivers dedupe by id;
// we do the same on the publish side so the committed JSONL is small
// and stable. New rows replace existing ones (so corrections propagate).
export function mergeJsonl(
  existing: string,
  newRows: Array<Record<string, unknown>>,
  idField: string
): string {
  const out = new Map<string, Record<string, unknown>>();
  for (const line of existing.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      const row = JSON.parse(t) as Record<string, unknown>;
      const id = row[idField];
      if (typeof id === 'string') out.set(id, row);
    } catch {
      // Skip unparseable lines; they would have failed the receiver's
      // validator too. We don't preserve garbage.
    }
  }
  for (const row of newRows) {
    const id = row[idField];
    if (typeof id === 'string') out.set(id, row);
  }
  // Stable sort by id so the file diff is reviewable.
  const sorted = [...out.values()].sort((a, b) =>
    String(a[idField]).localeCompare(String(b[idField]))
  );
  return sorted.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

// Builds the human-readable summary block that goes into the PR body. The
// receiver maintainer eyeballs this to decide whether to merge.
export function summarize(buckets: PayloadBucket[]): PayloadSummary {
  const jurisdictions = new Set<string>();
  const domains = new Set<string>();
  const sourceUrls = new Set<string>();
  let obligations = 0;
  let instruments = 0;
  let sources = 0;
  let minC = Infinity;
  let maxC = -Infinity;
  let sumC = 0;

  for (const b of buckets) {
    jurisdictions.add(b.jurisdiction);
    domains.add(b.domain);
    obligations += b.obligations.length;
    instruments += b.instruments.length;
    sources += b.sources.length;
    for (const o of b.obligations) {
      minC = Math.min(minC, o.confidence);
      maxC = Math.max(maxC, o.confidence);
      sumC += o.confidence;
    }
    for (const s of b.sources) sourceUrls.add(s.url);
  }

  const avg = obligations > 0 ? sumC / obligations : 0;
  return {
    buckets: buckets.length,
    obligations,
    instruments,
    sources,
    jurisdictions: [...jurisdictions].sort(),
    domains: [...domains].sort(),
    confidence: {
      min: Number.isFinite(minC) ? Number(minC.toFixed(3)) : 0,
      max: Number.isFinite(maxC) ? Number(maxC.toFixed(3)) : 0,
      avg: Number(avg.toFixed(3)),
    },
    source_urls: [...sourceUrls].sort(),
  };
}

// Renders the payload header — one line at the top of each JSONL file
// recording provenance. The receiver ignores lines starting with `#`
// (or our publisher writes header as a special "header" object the
// receiver knows to skip).
//
// For v1 we omit the header line and rely on the PR description for
// provenance; this keeps the JSONL files clean.
export function _formatHeader(header: PayloadHeader): string {
  return `# extracted_by=${header.extracted_by} payload_version=${header.payload_version}\n`;
}
