// Build-time loader for sampled source audits.
import sites from '../../data/sites.json';
import type { SourceAudit } from '@skillflux/bench/schema';
import { validateSourceAudits } from './source-audit-data';

let cache: Map<string, SourceAudit> | null = null;

function audits(): Map<string, SourceAudit> {
  if (!cache) {
    const files = import.meta.glob('../../data/source-audits/*.json', { eager: true }) as Record<string, { default: unknown }>;
    const list = validateSourceAudits(Object.keys(files).sort().map(key => files[key]!.default), new Set(sites.map(site => site.slug)));
    cache = new Map(list.map(audit => [audit.siteSlug, audit]));
  }
  return cache;
}

export function getSourceAudit(siteSlug: string): SourceAudit | undefined { return audits().get(siteSlug); }
export function getSourceAudits(): SourceAudit[] { return [...audits().values()]; }
