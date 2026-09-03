/**
 * One-off, run-via-workflow_dispatch live check of "Try demo" isolation
 * against the real deployed URLs (see .github/workflows/live-demo-mode-check.yml).
 *
 * Not part of the regular CI suite - it hits real production infrastructure
 * (Vercel + Railway), so it only runs on demand, triggered manually while
 * investigating or verifying a demo-mode isolation fix. Exists because the
 * sandbox this was authored in has no outbound network access to either
 * production host, so this script is the actual mechanism used to reproduce
 * and then verify the bug against live production with a real browser.
 *
 * Prints a structured PASS/FAIL report to stdout for each of three
 * scenarios (contexts A/B/C below) and exits non-zero if any check fails.
 */
import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "https://exit-keepa-web.vercel.app";
const REAL_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const HOSTILE_SAFE_ID = "11111111-1111-4111-8111-111111111111";

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
}

function attachNetworkLog(page, log) {
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/") || url.includes("safe.global") || url.includes("gnosisguild")) {
      log.push({ type: "request", method: req.method(), url, headers: req.headers() });
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      let body = null;
      try {
        body = await res.text();
      } catch {}
      log.push({ type: "response", status: res.status(), url: res.url(), body });
    }
  });
  page.on("popup", (popup) => log.push({ type: "popup", url: popup.url() }));
}

/** The list endpoint is GET /api/safe-accounts with nothing after it - distinct from
 * GET /api/safe-accounts/:id, whose path has an extra segment, and from the
 * :id/balances sub-resource. Matching on the exact pathname (not a substring)
 * avoids the id-call and the list-call being confused for one another. */
function findSafeListResponse(log) {
  return log.find((e) => e.type === "response" && new URL(e.url).pathname === "/api/safe-accounts");
}
function findSafeGetRequest(log) {
  return log.find((e) => e.type === "request" && /^\/api\/safe-accounts\/[^/]+$/.test(new URL(e.url).pathname));
}
function parseSafeList(res) {
  try {
    const body = JSON.parse(res?.body ?? "[]");
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

async function dumpLocalStorage(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
}

async function clickTryDemo(page) {
  const btn = page.getByRole("button", { name: /Try the demo, no wallet needed/i }).first();
  await btn.click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function runContextA(browser) {
  console.log("\n=== Context A: empty profile, single Try demo ===");
  const log = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  attachNetworkLog(page, log);

  await page.goto(WEB_URL, { waitUntil: "networkidle" });
  await clickTryDemo(page);

  const finalUrl = page.url();
  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  const demoSessionCall = log.find((e) => e.type === "response" && e.url.includes("/api/auth/demo-session"));
  const safeListCall = findSafeListResponse(log);
  const safeGetReq = findSafeGetRequest(log);
  const navigatedToSafeGlobal = log.some((e) => e.url && (e.url.includes("safe.global") || e.url.includes("gnosisguild")));

  check("POST /api/auth/demo-session returned 200", demoSessionCall?.status === 200, `status=${demoSessionCall?.status}`);
  let demoBody = {};
  try {
    demoBody = JSON.parse(demoSessionCall?.body ?? "{}");
  } catch {}
  check("demo-session response has a token", Boolean(demoBody.token));

  const listBody = parseSafeList(safeListCall);
  const sandboxSafe = listBody[0] ?? null;
  check("listMySafeAccounts returned exactly one safe", Array.isArray(listBody) && listBody.length === 1, `count=${listBody?.length}`);
  check("returned safe has isSandbox: true", sandboxSafe?.isSandbox === true, `isSandbox=${sandboxSafe?.isSandbox}`);
  check(
    "returned safe address is NOT the real production Safe",
    sandboxSafe?.safeAddress?.toLowerCase() !== REAL_SAFE.toLowerCase(),
    `safeAddress=${sandboxSafe?.safeAddress}`,
  );
  check("returned safe has rolesModifierAddress pre-filled", Boolean(sandboxSafe?.rolesModifierAddress));
  check(
    "GET /api/safe-accounts/:id request carried Authorization: Bearer <token>",
    Boolean(safeGetReq?.headers?.authorization?.startsWith("Bearer ")),
  );

  check("page body never contains the real production Safe address", !bodyText.includes(REAL_SAFE), REAL_SAFE);
  check("no navigation/popup to app.safe.global or roles.gnosisguild.org", !navigatedToSafeGlobal);
  check(
    "dashboard shows 'Roles permission ready' copy, not a Zodiac setup wall",
    bodyText.includes("Roles permission ready") && !bodyText.includes("Set up in Zodiac Roles app"),
  );
  check("final URL is the dashboard, not an external Safe app", finalUrl.includes("/dashboard"), finalUrl);

  await context.close();
  return { sandboxSafe, log, finalUrl, bodyText };
}

async function runContextB(browser) {
  console.log("\n=== Context B: hostile localStorage mimicking a prior real session ===");
  const log = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  attachNetworkLog(page, log);

  await page.goto(WEB_URL, { waitUntil: "networkidle" });
  await page.evaluate(
    ({ realSafe, hostileSafeId }) => {
      // Every plausible key the app could use for a persisted prior real
      // session, planted directly - including the demo label itself, in
      // case a future refactor ever reads it.
      localStorage.setItem("exit-keepa:safe-id:demo-mode", hostileSafeId);
      localStorage.setItem(`exit-keepa:safe-id:${realSafe.toLowerCase()}`, hostileSafeId);
      localStorage.setItem("exit-keepa:token", "hostile-fake-token");
      localStorage.setItem("exit-keepa:address", realSafe);
      localStorage.setItem("auth_token", "hostile-fake-token");
      localStorage.setItem("address", realSafe);
    },
    { realSafe: REAL_SAFE, hostileSafeId: HOSTILE_SAFE_ID },
  );

  const plantedStorage = await dumpLocalStorage(page);
  console.log("Planted localStorage:", JSON.stringify(plantedStorage));

  await clickTryDemo(page);

  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  const safeListCall = findSafeListResponse(log);
  const listBody = parseSafeList(safeListCall);
  const sandboxSafe = listBody[0] ?? null;

  check("hostile localStorage did not survive into the resolved safe id", sandboxSafe?.id !== HOSTILE_SAFE_ID, `id=${sandboxSafe?.id}`);
  check("real Safe address never shown after hostile localStorage + Try demo", !bodyText.includes(REAL_SAFE));
  check("resolved safe still isSandbox: true despite hostile localStorage", sandboxSafe?.isSandbox === true);
  check(
    "dashboard still shows sandbox-ready Roles copy, not the setup wall",
    bodyText.includes("Roles permission ready") && !bodyText.includes("Set up in Zodiac Roles app"),
  );

  await context.close();
  return { sandboxSafe };
}

async function runContextC(browser) {
  console.log("\n=== Context C: two parallel empty profiles ===");
  const [logX, logY] = [[], []];
  const [ctxX, ctxY] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageX, pageY] = await Promise.all([ctxX.newPage(), ctxY.newPage()]);
  attachNetworkLog(pageX, logX);
  attachNetworkLog(pageY, logY);

  await Promise.all([
    pageX.goto(WEB_URL, { waitUntil: "networkidle" }),
    pageY.goto(WEB_URL, { waitUntil: "networkidle" }),
  ]);
  await Promise.all([clickTryDemo(pageX), clickTryDemo(pageY)]);

  const safeX = parseSafeList(findSafeListResponse(logX))[0] ?? null;
  const safeY = parseSafeList(findSafeListResponse(logY))[0] ?? null;

  check("both parallel demo sessions resolved a safe", Boolean(safeX && safeY));
  check(
    "the two parallel demo sessions got DIFFERENT safe ids",
    Boolean(safeX && safeY && safeX.id !== safeY.id),
    `X=${safeX?.id} Y=${safeY?.id}`,
  );
  check(
    "the two parallel demo sessions got DIFFERENT safe addresses",
    Boolean(safeX && safeY && safeX.safeAddress !== safeY.safeAddress),
    `X=${safeX?.safeAddress} Y=${safeY?.safeAddress}`,
  );

  await Promise.all([ctxX.close(), ctxY.close()]);
}

/**
 * Informational only (never affects the pass/fail exit code): probes the
 * specific race this bug's root cause traces to - Dashboard's data-fetching
 * effects have no request-staleness guard, so a slower fetch tied to an
 * older identity can resolve after a newer one and silently overwrite it.
 * Firing two demo-session starts back-to-back (the Nav button had no
 * disabled-while-pending guard) is the most reliably automatable way to
 * open that window without a real wallet. Timing-dependent by nature, so
 * this is corroborating evidence, not a hard pass/fail assertion.
 */
async function runContextD(browser) {
  console.log("\n=== Context D (informational): rapid double Try-demo, race probe ===");
  const log = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  attachNetworkLog(page, log);
  await page.goto(WEB_URL, { waitUntil: "networkidle" });

  const btn = page.getByRole("button", { name: /Try the demo, no wallet needed/i }).first();
  await Promise.all([btn.click(), btn.click().catch(() => {})]);
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const demoSessionCalls = log.filter((e) => e.type === "response" && e.url.includes("/api/auth/demo-session") && e.status === 200);
  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  console.log(`  overlapping demo-session calls fired: ${demoSessionCalls.length}`);
  console.log(`  final body contains real Safe address: ${bodyText.includes(REAL_SAFE)}`);
  console.log(`  final body shows Roles setup wall: ${bodyText.includes("Set up in Zodiac Roles app")}`);

  await context.close();
}

const browser = await chromium.launch();
try {
  await runContextA(browser);
  await runContextB(browser);
  await runContextC(browser);
  await runContextD(browser);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n=== SUMMARY: ${checks.length - failed.length}/${checks.length} checks passed ===`);
if (failed.length > 0) {
  console.log("FAILED CHECKS:");
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? " (" + f.detail + ")" : ""}`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
