/**
 * Live, read-only verification of the protection gate against production.
 *
 * Proves four things about the deployed API:
 *   1. Both deploys are healthy.
 *   2. GET /authorization on the project's own documented Safe reports
 *      protected, naming the real Roles Modifier, with no read error.
 *   3. POST /authorization/prepare on that Safe is not an unexplained 502 -
 *      a demo session is not one of its owners, so the honest answer is 403.
 *   4. A Safe that is NOT verifiably protected cannot get a strategy: the
 *      create call must be refused with 409.
 *
 * Nothing is signed, deployed, or broadcast. Registering an address under a
 * fresh demo session only writes a row in Exit Keepa's own database; it
 * grants the session no on-chain capability whatsoever.
 */
const API_URL = process.env.API_URL || "https://api-production-2e11.up.railway.app";
const WEB_URL = process.env.WEB_URL || "https://exit-keepa-web.vercel.app";
const REAL_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const KNOWN_ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
/** A real Base contract that is definitively not a Safe - WETH. */
const NOT_A_SAFE = "0x4200000000000000000000000000000000000006";
const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function api(path, { token, method = "GET", body, base = API_URL } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  return { status: res.status, body: json, raw: text };
}

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
}

console.log("=== Deploy health ===");
const apiHealth = await api("/health");
check("the API deploy is healthy", apiHealth.status === 200, `status=${apiHealth.status} ${apiHealth.raw?.slice(0, 120)}`);
const webHealth = await api("/api/health", { base: WEB_URL });
check("the frontend deploy is healthy", webHealth.status === 200, `status=${webHealth.status} ${webHealth.raw?.slice(0, 120)}`);

const session = await api("/api/auth/demo-session", { method: "POST", body: {} });
const token = session.body?.token;
check("a session is issued", session.status === 200 && Boolean(token));

// Three independent rounds. One lucky read against a public RPC proves
// nothing; the read has to finish repeatably or it is not fixed.
console.log("\n=== The documented Safe reads as protected from chain (3 rounds) ===");
let lastRealSafeId = null;
let lastRoundToken = token;
for (let round = 1; round <= 3; round++) {
  const roundSession = await api("/api/auth/demo-session", { method: "POST", body: {} });
  const roundToken = roundSession.body?.token;
  const real = await api("/api/safe-accounts", { token: roundToken, method: "POST", body: { chainId: 8453, safeAddress: REAL_SAFE } });
  const auth = await api(`/api/safe-accounts/${real.body?.id}/authorization`, { token: roundToken });
  lastRealSafeId = real.body?.id;
  lastRoundToken = roundToken;

  console.log(`round ${round}: GET /authorization ->`, JSON.stringify(auth.body));
  check(`round ${round}: answers 200, not 409/500`, auth.status === 200, `status=${auth.status}`);
  check(`round ${round}: state is protected, not undetermined`, auth.body?.state === "protected", `state=${auth.body?.state}`);
  check(`round ${round}: names the real Roles Modifier`, auth.body?.detectedModifierAddress?.toLowerCase() === KNOWN_ROLES_MODIFIER.toLowerCase(), `detected=${auth.body?.detectedModifierAddress}`);
  check(`round ${round}: the chain read itself succeeded`, auth.body?.undetermined === null, `undetermined=${auth.body?.undetermined}`);
  check(`round ${round}: proved by reading the exact on-chain permission`, auth.body?.permissionChecked === true, `permissionChecked=${auth.body?.permissionChecked}`);
}

console.log("\n=== prepare answers about ownership, not about the network ===");
const prepare = await api(`/api/safe-accounts/${lastRealSafeId}/authorization/prepare`, { token: lastRoundToken, method: "POST", body: {} });
console.log("POST /authorization/prepare ->", prepare.status, JSON.stringify(prepare.body));
const prepareMessage = String(prepare.body?.message ?? prepare.body?.error ?? "");
check(
  "prepare is not a network failure (502/429/rate limit)",
  prepare.status !== 502 && !/rate limit|429/i.test(prepareMessage),
  `status=${prepare.status} message=${prepareMessage.slice(0, 160)}`,
);
check(
  "a demo session is told plainly it does not own this Safe",
  prepare.status === 403 && /not an owner/i.test(prepareMessage),
  `status=${prepare.status} message=${prepareMessage.slice(0, 160)}`,
);

console.log("\n=== An unprotected Safe cannot get a strategy ===");
const unprotected = await api("/api/safe-accounts", { token, method: "POST", body: { chainId: 8453, safeAddress: NOT_A_SAFE } });
check("a non-Safe address registers as a plain row", unprotected.status === 201, unprotected.raw?.slice(0, 140));

const unprotectedAuth = await api(`/api/safe-accounts/${unprotected.body?.id}/authorization`, { token });
console.log("GET /authorization (not a Safe) ->", JSON.stringify(unprotectedAuth.body));
check("it is never reported as protected", unprotectedAuth.body?.state !== "protected", `state=${unprotectedAuth.body?.state}`);

const blocked = await api("/api/exit-strategies", {
  token,
  method: "POST",
  body: {
    safeId: unprotected.body?.id,
    name: "Live protection gate check",
    condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
    action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" },
  },
});
console.log("POST /exit-strategies (unprotected Safe) ->", blocked.status, JSON.stringify(blocked.body));
check("creating a strategy against it is refused with 409", blocked.status === 409, `status=${blocked.status}`);
check(
  "the refusal is in plain English, with no backend jargon",
  !/zodiac|roles modifier|rpc|http \d{3}|undetermined/i.test(String(blocked.body?.message ?? blocked.body?.error ?? "")),
  `message=${String(blocked.body?.message ?? blocked.body?.error ?? "").slice(0, 160)}`,
);

const listed = await api(`/api/exit-strategies?safeId=${unprotected.body?.id}`, { token });
check("and no strategy row was created for it", Array.isArray(listed.body) && listed.body.length === 0, `count=${Array.isArray(listed.body) ? listed.body.length : "n/a"}`);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? " :: " + f.detail : ""}`);
  process.exit(1);
}
