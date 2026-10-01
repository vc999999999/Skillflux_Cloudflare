import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let closing = false;
console.error('SkillFlux web: http://127.0.0.1:4321');
console.error('No backend service: curated content comes from data/registry-publication.json');

function start(args, cwd, env) {
  const child = spawn(process.execPath, args, {cwd, env:{...process.env,...env}, stdio:'inherit', shell:false});
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!closing) stop(code ?? 1); });
}
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
  const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 3000);
  timer.unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
start([resolve(root, 'scripts/web-dev.mjs')], resolve(root, 'web'), {SKILLFLUX_CATALOG_REPO: process.env.SKILLFLUX_CATALOG_REPO});
