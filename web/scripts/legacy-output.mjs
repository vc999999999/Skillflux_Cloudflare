// Cloudflare Workers Builds for this project was configured when production
// output lived in .publication/production/dist. Mirror the static build there
// so a deploy command that still names that path keeps working. Remove once
// the Cloudflare deploy command points at web/dist.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(web, 'dist');
const target = join(web, '.publication', 'production', 'dist');
if (!existsSync(join(source, '_worker.js'))) throw new Error('web/dist/_worker.js is missing; run the build first');
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log('Mirrored web/dist to web/.publication/production/dist for the legacy deploy path.');
