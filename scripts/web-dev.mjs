import { dev } from 'astro';

// Use Astro's process API so a supervised two-service launch cannot auto-daemonize.
const server = await dev({
  root: new URL('../web/', import.meta.url),
  server: { host: '127.0.0.1', port: 4321 },
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
