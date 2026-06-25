import { homedir } from "node:os";
import { join } from "node:path";

export const SKILLFLUX_DIR = join(homedir(), ".skillflux");
export const CONFIG_PATH = join(SKILLFLUX_DIR, "config.json");
export const CACHE_DIR = join(SKILLFLUX_DIR, "cache");
export const BIN_DIR = join(SKILLFLUX_DIR, "bin");
export const SKILLFLUX_BIN = join(BIN_DIR, "skillflux");
