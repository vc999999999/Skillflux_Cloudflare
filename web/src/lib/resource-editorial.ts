import editorialData from '../../data/resource-editorial.json';

export type ResourceText = { zh: string; en: string };
export type ResourceEditorial = {
  resourceSlug: string;
  /** Date the editorial content changed, never the build date. */
  updatedAt: string;
  primaryCapability: ResourceText;
  summary: ResourceText;
  bestFor: ResourceText[];
  useCases: string[];
  skillFluxNote: ResourceText;
  limitations: ResourceText[];
  alternativeSlugs: string[];
  alternativeReasons: Record<string, ResourceText>;
  relatedGuideSlugs: string[];
  capabilityBreakdown?: Array<{ title: ResourceText; description: ResourceText; sourceUrl: string }>;
  workflowSteps?: Array<{ title: ResourceText; description: ResourceText }>;
};

const records: Record<string, ResourceEditorial> = editorialData;

export function getResourceEditorial(legacySlug: string): ResourceEditorial | undefined {
  return Object.prototype.hasOwnProperty.call(records, legacySlug) ? records[legacySlug] : undefined;
}

type ResourceIdentity = {
  slug: string;
  name: string;
  canonicalUrl: string;
  type: string;
  category: string;
  status?: string;
};

function hasBothLanguages(value: ResourceText | undefined): boolean {
  return Boolean(value?.zh?.trim() && value?.en?.trim());
}

/** Incomplete editorial records remain accessible, but must not enter search indexes. */
export function isResourceIndexable(site: ResourceIdentity): boolean {
  const editorial = getResourceEditorial(site.slug);
  if (!editorial || site.status === 'archived') return false;
  return Boolean(
    site.name?.trim() && site.type?.trim() && site.category?.trim() &&
    /^https?:\/\//.test(site.canonicalUrl) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editorial.resourceSlug) &&
    /^\d{4}-\d{2}-\d{2}$/.test(editorial.updatedAt) &&
    hasBothLanguages(editorial.primaryCapability) && hasBothLanguages(editorial.summary) &&
    editorial.bestFor?.length && editorial.bestFor.every(hasBothLanguages) &&
    editorial.useCases?.length && editorial.useCases.length <= 3 &&
    hasBothLanguages(editorial.skillFluxNote) &&
    editorial.limitations?.length && editorial.limitations.every(hasBothLanguages) &&
    editorial.alternativeSlugs?.length &&
    editorial.alternativeSlugs.every(slug => slug !== site.slug && getResourceEditorial(slug) && hasBothLanguages(editorial.alternativeReasons[slug])) &&
    editorial.relatedGuideSlugs?.length
  );
}
