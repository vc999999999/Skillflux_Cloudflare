import { scenarios } from '../../lib/scenarios';
export const prerender = true;
export function GET() { return new Response(JSON.stringify({ schema: 'skillflux-scenarios/v1', items: scenarios.map(item => ({ ...item, urls: { en: `/scenarios/${item.slug}/`, zh: `/zh/scenarios/${item.slug}/` } })) }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
