#!/usr/bin/env node
/**
 * Entry point for MCP clients.
 *
 * Exit Keepa's MCP server is TypeScript that imports the API's own
 * execution helpers directly from source - that is deliberate (see
 * ../README.md: the adapter has to run the same code the product runs, not
 * a copy of it), and it means there is no build artifact to point a client
 * at. tsx is registered here so `exit-keepa-mcp` is a single command an MCP
 * client can spawn with no build step and no stale dist/ to drift out of
 * sync.
 *
 * Both hooks are registered, and in this order: this package is ESM, but
 * apps/api is CommonJS, so loading its source needs tsx's require hook as
 * well as its import hook. Registering only the ESM one fails at the first
 * apps/api file that requires a sibling.
 *
 * stdout belongs to the MCP protocol. Nothing here may write to it.
 */
import { register as registerCommonJs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCommonJs();
registerEsm();

await import(new URL("../src/server.ts", import.meta.url).href);
