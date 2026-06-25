#!/usr/bin/env node
/** @deprecated Use `skillflux mcp start`. Kept for backward compatibility. */
import { startMcpServer } from "../mcp/server.js";

startMcpServer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
