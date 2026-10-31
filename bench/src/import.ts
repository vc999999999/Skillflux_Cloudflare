// Discovers SKILL.md packages in a repository at an exact commit and writes
// draft skill records. Existing records are never overwritten: curation
// (summaries, category, status) is a human edit.
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readFrontmatter } from './health/frontmatter.js';
import { SkillRecord } from './schema.js';
import { SKILLS_DIR, today, writeJson } from './paths.js';
import { fetchSnapshot, findSkillDirs, listFiles } from './source/fetch.js';
import { headSha, parseRepoUrl, repoMeta } from './source/github.js';

export interface ImportOptions {
  repo: string;
  sha?: string;
  paths?: string[];
  sourceSiteSlug: string;
  category: string;
  author?: string;
  authorUrl?: string;
  limit?: number;
}

export function skillId(owner: string, repo: string, name: string): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const parts = [slug(owner), slug(repo)];
  const tail = slug(name);
  // A single-skill repository named after its skill gets no repeated suffix.
  return [...parts, ...(tail && tail !== parts[1] ? [tail] : [])].join('-');
}

export async function importRepo(options: ImportOptions): Promise<string[]> {
  const ref = parseRepoUrl(options.repo);
  const sha = options.sha ?? await headSha(ref);
  const root = await fetchSnapshot(ref, sha);
  const meta = await repoMeta(ref).catch(() => null);
  let dirs = await findSkillDirs(root);
  if (options.paths?.length) dirs = dirs.filter(dir => options.paths!.includes(dir));
  if (options.limit) dirs = dirs.slice(0, options.limit);
  const files = await listFiles(root);
  const written: string[] = [];
  for (const dir of dirs) {
    const skillMd = files.find(file => file.path === (dir ? `${dir}/SKILL.md` : 'SKILL.md'))!;
    const front = readFrontmatter(skillMd.content.toString('utf8'));
    const name = typeof front.data?.name === 'string' ? front.data.name.trim() : posix.basename(dir) || ref.repo;
    const description = typeof front.data?.description === 'string' ? front.data.description.trim() : '';
    const id = skillId(ref.owner, ref.repo, posix.basename(dir) || name);
    const path = join(SKILLS_DIR, `${id}.json`);
    if (existsSync(path)) continue;
    const date = today();
    const placeholder = 'Draft: SkillFlux has not written a summary for this skill yet.';
    const record = SkillRecord.parse({
      schema: 'skillflux-skill/v1',
      id,
      name,
      displayName: { en: name, zh: name },
      summary: { en: placeholder, zh: '草稿：SkillFlux 尚未为该 Skill 撰写摘要。' },
      upstreamDescription: description || '(no description in frontmatter)',
      source: { repo: `https://github.com/${ref.owner}/${ref.repo}`, path: dir, commitSha: sha, pinnedAt: date },
      author: { name: options.author ?? ref.owner, ...(options.authorUrl ? { url: options.authorUrl } : { url: `https://github.com/${ref.owner}` }) },
      license: { spdx: meta?.licenseSpdx ?? null, raw: typeof front.data?.license === 'string' ? front.data.license : null, file: null },
      sourceSiteSlug: options.sourceSiteSlug,
      category: options.category,
      tags: [],
      status: 'draft',
      addedAt: date,
      updatedAt: date,
    });
    await writeJson(path, record);
    written.push(id);
  }
  return written;
}
