import { isFacetedUrl } from './indexing-policy';
export { isFacetedUrl } from './indexing-policy';

export function updateClientRobots() {
  const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!robots) return;
  const base = robots.dataset.baseRobots ?? robots.content;
  robots.dataset.baseRobots = base;
  robots.content = isFacetedUrl(new URL(location.href)) ? 'noindex, follow' : base;
}
