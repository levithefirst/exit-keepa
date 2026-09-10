/**
 * A real-looking KeeperHub key so the two credential-gated tools reach the
 * mocked client instead of short-circuiting, then src/apiEnv.ts fills in
 * the rest of the API-only variables exactly as it does at runtime - the
 * tests run against the same env bootstrap the server uses, not a
 * hand-maintained copy of it.
 *
 * Dynamic import, not a static one: static imports are hoisted above the
 * assignment below, which would defeat the point.
 */
process.env.KEEPERHUB_API_KEY ??= "kh_test_key_not_real";

await import("../src/apiEnv");
