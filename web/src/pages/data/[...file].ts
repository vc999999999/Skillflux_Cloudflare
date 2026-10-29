import type { APIRoute } from 'astro';
import { getDatasetFiles } from '../../lib/dataset';

export const prerender = true;

export function getStaticPaths() {
  return getDatasetFiles().map(file => ({ params: { file: file.path }, props: { file } }));
}

export const GET: APIRoute = ({ props }) => {
  const { file } = props as { file: ReturnType<typeof getDatasetFiles>[number] };
  const charset = file.contentType.startsWith('text/') || file.contentType.includes('json') ? '; charset=utf-8' : '';
  return new Response(file.body, { headers: { 'Content-Type': `${file.contentType}${charset}` } });
};
