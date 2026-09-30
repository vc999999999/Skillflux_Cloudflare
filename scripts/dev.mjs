import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adminToken = process.env.SKILLFLUX_ADMIN_TOKEN || randomBytes(32).toString('base64url');
const registryUrl = process.env.SKILLFLUX_PUBLIC_URL || 'http://127.0.0.1:8787';
const children = [];
let closing = false;
console.error('SkillFlux web: http://127.0.0.1:4321');
console.error(`SkillFlux registry: ${registryUrl}`);
console.error('Operator console: http://127.0.0.1:4321/console/');
console.error(`Development operator token (this process only): ${adminToken}`);

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
start(['--import', import.meta.resolve('tsx'), resolve(root, 'mcp/src/cli.ts'), 'registry', '--dev'], resolve(root, 'mcp'), {SKILLFLUX_ADMIN_TOKEN:adminToken,SKILLFLUX_PUBLIC_URL:registryUrl,SKILLFLUX_DATA_DIR:process.env.SKILLFLUX_DATA_DIR || resolve(root, 'mcp/var')});
start([resolve(root, 'scripts/web-dev.mjs')], resolve(root, 'web'), {PUBLIC_REGISTRY_URL:registryUrl});
