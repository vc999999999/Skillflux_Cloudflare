// Phase 1 of hybrid retrieval: a deterministic, dependency-free semantic index
// computed by `skillflux catalog build` and shipped inside index.json.
//
// What gets vectorized: the skill's *capability* text (name, description, tags,
// category) and its *body* text (entry file plus bundled text resources). Source
// URLs (GitHub addresses and other links) are stripped before tokenizing: they
// remain source metadata in the manifest and never contribute to vectors.
//
// Model: hashed TF-IDF projection. Terms are hashed into a fixed number of
// signed dimensions, weighted by term frequency × inverse document frequency,
// then L2-normalized. A term-centroid table lets the client embed any query
// term into the same space without shipping a model, so search stays fully
// local. The `model.kind` string versions this scheme: a future
// `embedding/v1` section may replace the vectors with real embedding-model
// output while keeping the same offline query path through term centroids.

import { createHash } from 'node:crypto';
import type { CatalogIndexEntry } from './model.js';

export const SEMANTIC_MODEL = 'hashed-tfidf/v1';
export const SEMANTIC_DIMS = 128;
/** Cap the centroid table to bound index size. */
const MAX_CENTROID_TERMS = 4096;
/** Body-only terms must either occur in several docs or rank among the strongest
 * body terms of at least one doc; capability terms (name/description/tags/category)
 * always qualify because a df filter there would drop the most distinctive keys. */
const MIN_BODY_TERM_DF = 2;
const TOP_BODY_TERMS_PER_DOC = 30;
/** Store only the strongest components of each term centroid. */
const CENTROID_SPARSE_COMPONENTS = 12;
/** Quantization scale for stored vectors (integers, ±32767 int16 range headroom). */
const QUANT = 1000;

export interface SemanticSection {
  model: { kind: typeof SEMANTIC_MODEL; dims: number; quant: number };
  /** Doc vectors keyed by `<id>@<version>`, quantized integers. */
  skills: Record<string, number[]>;
  /** Sparse term centroids: term -> flat [dim, weight, dim, weight, ...]. */
  terms: Record<string, number[]>;
}

export interface SemanticDoc {
  id: string;
  version: string;
  /** Raw text per weighting bucket; body text uses weight 1. */
  capability: string[];
  body: string[];
}

/** Strip URLs (github addresses and any other links) so they stay source metadata only. */
export function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)>\]}"'`]+/gi, ' ')
    .replace(/\b[a-z0-9.-]+\.(?:com|org|io|net|dev|cn|ai|app)\b[^\s)>\]}"'`]*/gi, ' ');
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;

/** Tokenize mixed CJK/latin text. Latin words keep a length-based prefix form for
 * mild morphology tolerance; CJK runs expand to unigrams + bigrams. */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  const cleaned = stripUrls(text.toLowerCase());
  const runs = cleaned.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]+|[a-z0-9][a-z0-9+#.-]*[a-z0-9%]|[a-z0-9]/g) ?? [];
  for (const run of runs) {
    if (CJK.test(run)) {
      for (const char of run) terms.push(char);
      for (let index = 0; index + 1 < run.length; index += 1) terms.push(run.slice(index, index + 2));
      continue;
    }
    if (run.length >= 2) {
      terms.push(run);
      if (run.length >= 6) terms.push(run.slice(0, 5));
    }
  }
  return terms;
}

function hashDim(term: string, salt: string): { dim: number; sign: number } {
  const digest = createHash('sha256').update(`${salt}:${term}`).digest();
  const dim = digest.readUInt32BE(0) % SEMANTIC_DIMS;
  const sign = digest[4]! & 1 ? -1 : 1;
  return { dim, sign };
}

/** Weighted term frequencies for one document, split by text source so the
 * centroid table can prioritize capability vocabulary over body noise. */
function termWeights(doc: SemanticDoc): { capability: Map<string, number>; body: Map<string, number> } {
  const capability = new Map<string, number>();
  const body = new Map<string, number>();
  const add = (target: Map<string, number>, text: string, weight: number): void => {
    for (const term of tokenize(text)) target.set(term, (target.get(term) ?? 0) + weight);
  };
  // Capability text carries the strongest signal; body text is context, not identity.
  for (const text of doc.capability) { add(capability, text, 3); add(capability, text, 1.5); } // 4.5x effective
  for (const text of doc.body) add(body, text, 1);
  return { capability, body };
}

export interface SemanticBuildInput {
  docs: SemanticDoc[];
}

export function buildSemanticSection({ docs }: SemanticBuildInput): SemanticSection {
  const docWeights = docs.map(doc => ({ doc, split: termWeights(doc), weights: new Map<string, number>() }));
  for (const { split, weights } of docWeights) {
    for (const [term, weight] of split.capability) weights.set(term, (weights.get(term) ?? 0) + weight);
    for (const [term, weight] of split.body) weights.set(term, (weights.get(term) ?? 0) + weight);
  }
  const docFrequency = new Map<string, number>();
  for (const { weights } of docWeights) {
    for (const term of weights.keys()) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
  }
  const totalDocs = Math.max(1, docs.length);
  const idf = (term: string): number => {
    const frequency = docFrequency.get(term) ?? 0;
    return Math.log(1 + totalDocs / (1 + frequency));
  };

  const rawVectors = docWeights.map(({ weights }) => {
    const vector = new Float64Array(SEMANTIC_DIMS);
    for (const [term, weight] of weights) {
      const { dim, sign } = hashDim(term, 'doc');
      vector[dim] += sign * weight * idf(term);
    }
    return vector;
  });
  const normalize = (vector: Float64Array): void => {
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  };
  for (const vector of rawVectors) normalize(vector);

  const skills: Record<string, number[]> = {};
  docWeights.forEach(({ doc }, index) => {
    skills[`${doc.id}@${doc.version}`] = quantizeVector(rawVectors[index]!);
  });

  // Term centroids: idf-weighted centroid of the doc vectors containing the term.
  // Query terms are embedded by summing their centroids, which is what keeps a
  // future embedding-model section usable without a client-side model.
  // Capability vocabulary always earns a centroid; body-only terms need enough
  // cross-document presence to be worth their index bytes.
  const capabilityTerms = new Set<string>();
  for (const { split } of docWeights) for (const term of split.capability.keys()) capabilityTerms.add(term);
  const bodyDocFrequency = new Map<string, number>();
  for (const { split } of docWeights) {
    for (const term of split.body.keys()) bodyDocFrequency.set(term, (bodyDocFrequency.get(term) ?? 0) + 1);
  }
  const distinctiveBodyTerms = new Set<string>();
  for (const { split } of docWeights) {
    const ranked = [...split.body.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_BODY_TERMS_PER_DOC);
    for (const [term] of ranked) distinctiveBodyTerms.add(term);
  }
  const candidateTerms = [
    ...capabilityTerms,
    ...[...bodyDocFrequency.entries()]
      .filter(([term, frequency]) => !capabilityTerms.has(term) && (frequency >= MIN_BODY_TERM_DF || distinctiveBodyTerms.has(term)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([term]) => term),
  ]
    .slice(0, MAX_CENTROID_TERMS);
  candidateTerms.sort();
  const terms: Record<string, number[]> = {};
  for (const term of candidateTerms) {
    const centroid = new Float64Array(SEMANTIC_DIMS);
    docWeights.forEach(({ weights }, index) => {
      const weight = weights.get(term);
      if (!weight) return;
      const scaled = weight * idf(term);
      for (let dim = 0; dim < SEMANTIC_DIMS; dim += 1) centroid[dim] += scaled * rawVectors[index]![dim]!;
    });
    normalize(centroid);
    const sparse = sparseVector(centroid);
    if (sparse.length) terms[term] = sparse;
  }

  return { model: { kind: SEMANTIC_MODEL, dims: SEMANTIC_DIMS, quant: QUANT }, skills, terms };
}

function quantizeVector(vector: Float64Array): number[] {
  return Array.from(vector, value => Math.round(Math.max(-32, Math.min(32, value)) * QUANT));
}

function sparseVector(vector: Float64Array): number[] {
  const components = Array.from(vector.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, CENTROID_SPARSE_COMPONENTS)
    .filter(([, value]) => Math.abs(value) > 1e-6);
  const flat: number[] = [];
  for (const [dim, value] of components) flat.push(dim, Math.round(Math.max(-32, Math.min(32, value)) * QUANT));
  return flat;
}

/** Rehydrate a stored doc vector (quantized integers) into normalized floats. */
export function readDocVector(section: SemanticSection, id: string, version: string): Float64Array | null {
  const stored = section.skills[`${id}@${version}`];
  if (!stored || stored.length !== section.model.dims) return null;
  const vector = new Float64Array(stored.length);
  for (let index = 0; index < stored.length; index += 1) vector[index] = stored[index]! / section.model.quant;
  return vector;
}

/** Embed a query into the section's space via term centroids (offline, no model). */
export function embedQuery(section: SemanticSection, query: string): Float64Array | null {
  if (!section.terms || !section.model || section.model.dims !== SEMANTIC_DIMS) return null;
  const vector = new Float64Array(SEMANTIC_DIMS);
  const terms = tokenize(query);
  let matched = 0;
  for (const term of terms) {
    const centroid = section.terms[term];
    if (!centroid) continue;
    matched += 1;
    for (let index = 0; index + 1 < centroid.length; index += 2) {
      vector[centroid[index]!] += centroid[index + 1]! / section.model.quant;
    }
  }
  if (!matched) return null;
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index]! * b[index]!;
  return Math.max(-1, Math.min(1, dot));
}

/** Semantic input for one version directory, assembled where file content is loaded. */
export function semanticDocFor(manifest: { id: string; version: string; name: string; description: string; category: string; tags: string[]; entry?: string }, files: Record<string, string>): SemanticDoc {
  const entryText = manifest.entry && manifest.entry in files ? files[manifest.entry]! : Object.values(files)[0] ?? '';
  return {
    id: manifest.id,
    version: manifest.version,
    capability: [manifest.name, manifest.description, manifest.tags.join(' '), manifest.category, manifest.tags.join(' ')],
    body: [entryText, ...Object.entries(files).map(([path, content]) => `${path}\n${content}`)],
  };
}

export interface SemanticSearchResult {
  score: number;
}

/** Score one entry against a query vector; null when the entry has no vector. */
export function semanticScore(section: SemanticSection, entry: Pick<CatalogIndexEntry['skill'], 'id' | 'version'>, queryVector: Float64Array): SemanticSearchResult | null {
  const vector = readDocVector(section, entry.id, entry.version);
  if (!vector) return null;
  const cosine = cosineSimilarity(vector, queryVector);
  return { score: Math.max(0, cosine) };
}
