import { getPublication, skillPath } from '../lib/publication';
export const prerender = true;
export function GET() {
  const { snapshot, latest, statuses } = getPublication();
  return new Response(JSON.stringify({ schema: 'skillflux-public-index/v1', generatedAt: snapshot.fetchedAt, repo: snapshot.repo, freshness: 'build-snapshot-recheck-before-install', items: latest.map(({ skill }) => ({ ...skill, url: skillPath(skill.id), versionUrl: skillPath(skill.id, skill.version) })), versions: statuses.map(status => ({ ...status, url: skillPath(status.id, status.version) })) }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
