#!/usr/bin/env node
/**
 * `npm run judge` - everything a judge needs, printed from the code rather
 * than from a README that can rot.
 *
 * Deliberately derives each number instead of quoting one: the test counts
 * come from actually running the suites, the live-proof hash and execution
 * id come from packages/shared's single canonical record, and the
 * broadcast line reads the real environment through the same
 * `isBroadcastAllowed` the code paths use. A hard-coded "182 tests" in a
 * README is exactly the kind of claim this project should not be making.
 *
 *   npm run judge              # run the suites and report real counts
 *   npm run judge -- --fast    # skip the suites (everything else still real)
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAST = process.argv.includes("--fast");

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api-production-2e11.up.railway.app";
const WEB_URL = "https://exit-keepa-web.vercel.app";
const HEALTH_TIMEOUT_MS = 6_000;

const WORKSPACES = [
  { name: "packages/shared", label: "shared" },
  { name: "apps/api", label: "api" },
  { name: "packages/mcp", label: "mcp" },
];

const c = {
  bold: (s) => `[1m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  cyan: (s) => `[36m${s}[0m`,
};

function heading(text) {
  console.log(`\n${c.bold(text)}`);
  console.log(c.dim("-".repeat(text.length)));
}

function row(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

/**
 * packages/shared is consumed through its compiled dist/, so a fresh clone
 * has nothing to import until it is built. Build it rather than failing
 * with a resolution error a judge would have to decode.
 */
async function loadShared() {
  const entry = join(ROOT, "packages/shared/dist/index.js");
  try {
    return await import(pathToFileURL(entry).href);
  } catch {
    console.log(c.dim("  building packages/shared (first run) ..."));
    spawnSync("npm", ["run", "build", "--workspace", "packages/shared"], { cwd: ROOT, stdio: "ignore" });
    return await import(pathToFileURL(entry).href);
  }
}

/** Runs one workspace's vitest suite and reads the real counts out of its JSON report. */
function runSuite(workspace) {
  const dir = mkdtempSync(join(tmpdir(), "exit-keepa-judge-"));
  const outputFile = join(dir, "report.json");
  try {
    const result = spawnSync(
      "npx",
      ["vitest", "run", "--reporter=json", `--outputFile=${outputFile}`],
      { cwd: join(ROOT, workspace.name), stdio: "ignore", env: process.env },
    );
    const report = JSON.parse(readFileSync(outputFile, "utf8"));
    return {
      total: report.numTotalTests ?? 0,
      passed: report.numPassedTests ?? 0,
      failed: report.numFailedTests ?? 0,
      ok: result.status === 0,
    };
  } catch (err) {
    return { total: 0, passed: 0, failed: 0, ok: false, error: err.message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function checkHealth(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    return { reachable: response.ok, status: response.status, body };
  } catch (err) {
    return { reachable: false, status: null, error: err.name === "AbortError" ? "timed out" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const { EXIT_KEEPA_LIVE_PROOF, BROADCAST_ENV_FLAG, BROADCAST_ENV_ENABLED_VALUE, isBroadcastAllowed } =
  await loadShared();

console.log(c.bold("\nExit Keepa - judge summary"));
console.log(c.dim("Aave v3 + Gnosis Safe + Zodiac Roles, executed by KeeperHub, on Base mainnet."));

heading("Live proof (already on-chain - nothing to trigger)");
row("Transaction", c.cyan(EXIT_KEEPA_LIVE_PROOF.txHash));
row("BaseScan", EXIT_KEEPA_LIVE_PROOF.basescanUrl);
row("KeeperHub execution", EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId);
row("Safe", EXIT_KEEPA_LIVE_PROOF.safeAddress);
row("Roles Modifier", EXIT_KEEPA_LIVE_PROOF.rolesModifierAddress);
row("Aave v3 Pool", EXIT_KEEPA_LIVE_PROOF.aaveV3PoolAddress);
row("Receipt", `${EXIT_KEEPA_LIVE_PROOF.receiptStatus} in block ${EXIT_KEEPA_LIVE_PROOF.blockNumber}`);

heading("Broadcast");
const allowed = isBroadcastAllowed(process.env);
const raw = process.env[BROADCAST_ENV_FLAG];
row(
  BROADCAST_ENV_FLAG,
  raw === undefined ? c.green("unset") : allowed ? c.yellow(JSON.stringify(raw)) : c.green(JSON.stringify(raw)),
);
row(
  "MCP broadcast",
  c.green("DISABLED") +
    c.dim(" - the MCP server has no broadcast tool at all; simulate_exit refuses and names this flag"),
);
row(
  "Gated code paths",
  allowed
    ? c.yellow(`ENABLED - ${BROADCAST_ENV_FLAG} is exactly "${BROADCAST_ENV_ENABLED_VALUE}"`)
    : c.green(`DISABLED - nothing runs unless ${BROADCAST_ENV_FLAG} is exactly "${BROADCAST_ENV_ENABLED_VALUE}"`),
);
console.log(
  c.dim(
    "  The API's own autonomous path (execution/executeApproved.ts) is the one code path\n" +
      "  that has ever broadcast, and it is what produced the transaction above.",
  ),
);

heading("Live services");
row("Web app", WEB_URL);
row("Audit trail", `${WEB_URL}/audit`);
row("API health", `${API_URL}/health`);
const health = await checkHealth(API_URL);
row(
  "API status",
  health.reachable
    ? c.green(`reachable (${health.status})`)
    : c.yellow(`unreachable right now (${health.error ?? health.status}) - the BaseScan proof needs no server`),
);
row("Live-proof API", `${API_URL}/api/live-proof`);

heading("Agent surfaces");
row("MCP server", "node packages/mcp/bin/exit-keepa-mcp.mjs");
row("MCP tools", "evaluate_exit_condition, build_exit_calldata, simulate_exit,");
row("", "get_execution_status, get_live_proof");
row("Workflow artifact", "docs/workflows/aave-usdc-protective-exit.json");
row("Blocked call", `${WEB_URL}/audit -> "Try a blocked call"`);

heading("Tests");
if (FAST) {
  console.log(c.dim("  skipped (--fast). Run `npm run judge` without it for real counts."));
} else {
  let total = 0;
  let failed = 0;
  let allOk = true;
  for (const workspace of WORKSPACES) {
    const result = runSuite(workspace);
    total += result.total;
    failed += result.failed;
    allOk = allOk && result.ok;
    row(
      workspace.name,
      result.ok
        ? c.green(`${result.passed} passed`)
        : c.red(`${result.failed} failed of ${result.total}${result.error ? ` (${result.error})` : ""}`),
    );
  }
  row("Total", allOk ? c.green(`${total} passing`) : c.red(`${total} run, ${failed} failing`));
  if (!allOk) process.exitCode = 1;
}

console.log(
  `\n${c.dim("Full judge path: docs/JUDGE_DEMO.md. Submission write-up: docs/SUBMISSION.md.")}\n`,
);
