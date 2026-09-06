/**
 * One-off, read-only investigation of whether the deployed authorization
 * decoder (apps/api/src/safe/authorizationStatus.ts's decodeModulesPaginated
 * + detectZodiacModifier) correctly reads a REAL Base Safe's enabled-module
 * list and finds its REAL, already-configured Zodiac Roles Modifier.
 *
 * Never signs anything, never deploys anything, never touches the Safe's
 * chain state. Registering the Safe address under a fresh demo session is
 * a read-only DB row in Exit Keepa's own database (it does not grant the
 * session any onchain capability) - this only proves what the decoder
 * reports for a Safe whose real state is independently already known and
 * documented (README.md, docs/SUBMISSION.md): a genuine Roles Modifier IS
 * enabled on this Safe today.
 *
 * This exists because a bug report claimed the decoder mis-parses
 * getModulesPaginated's ABI response. That claim didn't match the code on
 * inspection (see conversation), but the only way to be certain is to run
 * the actual deployed decoder against a real Base RPC response, which this
 * sandbox cannot reach directly - hence a GitHub-hosted runner.
 */
const API_URL = process.env.API_URL || "https://api-production-2e11.up.railway.app";
const REAL_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const KNOWN_ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, raw: text };
}

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
}

const session = await api("/api/auth/demo-session", { method: "POST", body: {} });
const token = session.body?.token;
check("session issued", session.status === 200 && Boolean(token));

const created = await api("/api/safe-accounts", {
  token,
  method: "POST",
  body: { chainId: 8453, safeAddress: REAL_SAFE },
});
check("registered the project's own real, documented Safe", created.status === 201, created.raw?.slice(0, 150));

console.log(`\nCalling GET /api/safe-accounts/${created.body?.id}/authorization ...`);
const auth = await api(`/api/safe-accounts/${created.body?.id}/authorization`, { token });
console.log("Raw response:", JSON.stringify(auth.body, null, 2));

check(
  "the decoder found a Zodiac module enabled on this real Safe",
  Boolean(auth.body?.detectedModifierAddress),
  `detected=${auth.body?.detectedModifierAddress}`,
);
check(
  "the detected address matches the independently-documented Roles Modifier",
  auth.body?.detectedModifierAddress?.toLowerCase() === KNOWN_ROLES_MODIFIER.toLowerCase(),
  `expected=${KNOWN_ROLES_MODIFIER.toLowerCase()} got=${auth.body?.detectedModifierAddress}`,
);
check(
  "the read itself succeeded (no RPC/decode error)",
  auth.body?.undetermined === null,
  `undetermined=${auth.body?.undetermined}`,
);
check(
  "the state is NOT stuck at needs_module for a Safe with a real modifier enabled",
  auth.body?.state !== "needs_module",
  `state=${auth.body?.state}`,
);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? " :: " + f.detail : ""}`);
  process.exit(1);
}
