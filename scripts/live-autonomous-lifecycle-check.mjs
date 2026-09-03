/**
 * Live, end-to-end check of the AUTONOMOUS exit lifecycle against real
 * production (Vercel + Railway + Neon), driven by a real Chromium from a
 * GitHub-hosted runner - see .github/workflows/live-autonomous-lifecycle-check.yml.
 *
 * Manual only. It exists because the sandbox this was authored in has no
 * outbound network access to either production host, so this is the actual
 * mechanism used to walk the judge's journey from a clean state and verify
 * what the deployed system really does, rather than what the code says it
 * should do.
 *
 * The journey, exactly as a first-time visitor experiences it:
 *   1. Land on the site with a completely empty browser profile.
 *   2. Click "Try demo" - no wallet, no funds, no Safe, no setup.
 *   3. Create a strategy whose condition is ALREADY true.
 *   4. Activate it. Then stop touching it.
 *   5. Assert the strategy page reads WATCHING and that no Simulate /
 *      Execute / Broadcast button is on the normal path at all.
 *   6. Wait for the autonomous poller (30s interval) to do the rest, with
 *      no further interaction, and assert the exit completes.
 *   7. Assert the completion is honestly labelled: demo_completed, never
 *      "succeeded", and with no transaction hash anywhere on the page.
 *
 * Also walks the negative case: a condition that is NOT met must leave the
 * strategy watching with nothing executed.
 */
import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "https://exit-keepa-web.vercel.app";
const API_URL = process.env.API_URL || "https://api-production-2e11.up.railway.app";
const REAL_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drives the API directly with a demo session token - the same endpoints the UI calls. */
async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body: json, raw: text };
}

async function apiJourney() {
  console.log("\n=== A. The autonomous lifecycle, driven only by activation ===");

  const session = await api("/api/auth/demo-session", { method: "POST", body: {} });
  check("demo session issued", session.status === 200 && Boolean(session.body?.token));
  const token = session.body?.token;
  if (!token) return;

  const safes = await api("/api/safe-accounts", { token });
  const safe = safes.body?.[0];
  check("a private sandbox Safe was auto-provisioned", Boolean(safe?.isSandbox), safe?.safeAddress);
  check(
    "it is NOT the project's real Safe",
    safe?.safeAddress?.toLowerCase() !== REAL_SAFE.toLowerCase(),
    safe?.safeAddress,
  );

  // A condition that is already true right now: supply APR is never >= 100%.
  const created = await api("/api/exit-strategies", {
    token,
    method: "POST",
    body: {
      safeId: safe.id,
      name: "Live autonomous lifecycle check",
      condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 10000 },
      action: {
        protocol: "aave-v3-base",
        action: "withdraw",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "max",
      },
    },
  });
  check("strategy created", created.status === 201, created.raw?.slice(0, 200));
  const strategyId = created.body?.id;
  if (!strategyId) return;

  const activated = await api(`/api/exit-strategies/${strategyId}/activate`, { token, method: "POST" });
  check("strategy activated", activated.status === 200 && activated.body?.status === "active");

  // From here on: NOTHING is called that could execute anything. No
  // /executions, no /simulate, no /broadcast, no /agent/evaluate. Only
  // reads. If an exit happens, the deployed poller did it unattended.
  console.log("  ...waiting for the autonomous poller (reads only from here)");
  let executions = [];
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await sleep(10_000);
    const list = await api(`/api/exit-strategies/${strategyId}/executions`, { token });
    executions = list.body ?? [];
    const terminal = executions.find((e) =>
      ["demo_completed", "succeeded", "failed", "refused", "blocked"].includes(e.status),
    );
    if (terminal) break;
    console.log(`  ...still waiting (${executions.length} execution row(s), statuses: ${executions.map((e) => e.status).join(",") || "none"})`);
  }

  check("the poller executed the exit with zero user interaction", executions.length === 1, `${executions.length} execution row(s)`);
  const exec = executions[0];
  if (!exec) return;

  check("lifecycle reached a terminal state", exec.status === "demo_completed", `status=${exec.status}`);
  check("NOT reported as a real onchain success", exec.status !== "succeeded", `status=${exec.status}`);
  check("no transaction hash was invented", exec.txHash === null || exec.txHash === undefined, String(exec.txHash));
  check("no broadcastAt timestamp was invented", !exec.broadcastAt, String(exec.broadcastAt));
  check(
    "the response payload says plainly that nothing reached a chain",
    typeof exec.responsePayload?.note === "string" && /nothing was sent to any blockchain/i.test(exec.responsePayload.note),
    exec.responsePayload?.note?.slice(0, 120),
  );
  check("it was created by the guardian, not a manual click", exec.createdVia === "guardian", exec.createdVia);

  // Repeated polling must not produce a second execution.
  await sleep(45_000);
  const after = await api(`/api/exit-strategies/${strategyId}/executions`, { token });
  check("repeated polling never re-executes", (after.body ?? []).length === 1, `${(after.body ?? []).length} row(s)`);

  // The receipt chain is intact and independently fetchable.
  const decisions = await api(`/api/exit-strategies/${strategyId}/agent/decisions`, { token });
  const triggered = (decisions.body ?? []).find((d) => d.decision === "triggered");
  check("a triggered decision receipt exists", Boolean(triggered));
  check("the receipt's own source is the autonomous poller", triggered?.source === "poller", triggered?.source);
  check("every policy check passed in the receipt", Object.values(triggered?.policyCheck?.policy ?? {}).every(Boolean));
  check(
    "the receipt's final result matches the execution row",
    triggered?.finalOnchainResult?.status === exec.status && !triggered?.finalOnchainResult?.txHash,
    `${triggered?.finalOnchainResult?.status} / ${triggered?.finalOnchainResult?.txHash}`,
  );

  return { token, strategyId };
}

async function negativeCase() {
  console.log("\n=== B. A condition that is NOT met executes nothing ===");
  const session = await api("/api/auth/demo-session", { method: "POST", body: {} });
  const token = session.body?.token;
  const safes = await api("/api/safe-accounts", { token });
  const safe = safes.body?.[0];

  // Supply APR is never below 0.0001% - this condition cannot be true.
  const created = await api("/api/exit-strategies", {
    token,
    method: "POST",
    body: {
      safeId: safe.id,
      name: "Live negative-case check",
      condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 1 },
      action: {
        protocol: "aave-v3-base",
        action: "withdraw",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "max",
      },
    },
  });
  const strategyId = created.body?.id;
  await api(`/api/exit-strategies/${strategyId}/activate`, { token, method: "POST" });

  await sleep(90_000); // at least three poll intervals

  const list = await api(`/api/exit-strategies/${strategyId}/executions`, { token });
  check("nothing was executed while the condition is false", (list.body ?? []).length === 0, `${(list.body ?? []).length} row(s)`);

  const decisions = await api(`/api/exit-strategies/${strategyId}/agent/decisions`, { token });
  const normals = (decisions.body ?? []).filter((d) => d.decision === "normal");
  check("but the agent did observe and record ticks", normals.length > 0, `${normals.length} 'normal' decision(s)`);
  return { token, strategyId };
}

/**
 * The journey a judge actually walks, in a real browser, with an empty
 * profile - no wallet, no funds, no Safe, no setup. The session token is
 * held in memory by the app (never persisted), so this has to be one
 * continuous session: Try demo -> create -> activate -> stop touching it.
 */
async function uiJourney() {
  console.log("\n=== C. The judge's journey, in a real browser, from a clean state ===");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(WEB_URL, { waitUntil: "load" });
  await page.getByRole("button", { name: /Try the demo, no wallet needed/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  check("landed on the dashboard with no wallet prompt", /\/dashboard/.test(page.url()), page.url());

  await page.getByRole("link", { name: /New strategy/i }).first().click();
  await page.waitForURL(/\/create/, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.locator("#strategy-name").fill("Live judge-journey check");
  // A condition that is already true: supply APR is never at or above 100%.
  await page.locator("select").first().selectOption("lt");
  await page.getByLabel("Threshold percentage").fill("100");
  await page.getByRole("button", { name: /Preview transaction/i }).click();
  await page.waitForTimeout(4000);

  const reviewText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check("the review screen shows the exact transaction before activation", /Review before you activate/i.test(reviewText));

  await page.getByRole("button", { name: /^Activate strategy$/i }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /View strategy/i }).click();
  await page.waitForURL(/\/strategy\//, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // ---- From here the user does NOTHING. No clicking at all. ----
  const initial = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const buttons = (await page.locator("button").allInnerTexts()).map((t) => t.trim());

  check("the page speaks in product terms, not machine states", /What I'm protecting/i.test(initial), initial.slice(0, 160));
  check("it states the exit condition in plain English", /Exit condition/i.test(initial));
  check("it states what Exit Keepa will do", /What Exit Keepa will do/i.test(initial));
  check(
    "no Simulate / Execute / Broadcast control is on the normal path",
    !buttons.some((b) => /^(Simulate|Execute \(broadcast\)|Confirm broadcast)$/i.test(b)),
    buttons.join(" | "),
  );

  console.log("  ...not touching the page; waiting for the autonomous poller");
  let finalText = initial;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(15_000);
    // Deliberately NOT a reload and NOT a click - just reading what the
    // open page now shows. The page has to update itself, because that is
    // the actual product promise: activate it and walk away. A live check
    // that reloaded here would have hidden the very bug it caught (the
    // page never re-fetched while watching, so an exit that had already
    // completed never appeared).
    finalText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    if (/Demo execution completed/i.test(finalText)) break;
    console.log("  ...still waiting");
  }

  check("the exit completed with no further user interaction", /Demo execution completed/i.test(finalText), finalText.slice(0, 200));
  check("it never claims a real onchain confirmation", !/Confirmed onchain/i.test(finalText));
  check("no transaction hash is shown anywhere on the page", !/0x[a-fA-F0-9]{64}/.test(finalText));
  check("the page never says the demo failed", !/did not go through/i.test(finalText));

  await browser.close();
}

await apiJourney();
await negativeCase();
await uiJourney();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? " :: " + f.detail : ""}`);
  process.exit(1);
}
