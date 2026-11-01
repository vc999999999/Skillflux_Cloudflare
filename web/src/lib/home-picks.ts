// Editor's picks shown on the home page. Edit data/home-picks.json; every
// slug must exist in sites.json or the build fails.
import picksData from '../../data/home-picks.json';
import { getSiteBySlug, type Site } from './content';
import type { ResourceText } from './resource-editorial';

export type HomePick = { slug: string; badge: ResourceText; reason: ResourceText; best: ResourceText };

export function getHomePicks(): Array<HomePick & { site: Site }> {
  return (picksData as HomePick[]).map(pick => {
    const site = getSiteBySlug(pick.slug);
    if (!site) throw new Error(`data/home-picks.json: unknown site slug "${pick.slug}"`);
    return { ...pick, site };
  });
}
