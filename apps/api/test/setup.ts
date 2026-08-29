// Test-only env values so apps/api/src/env.ts's Zod validation passes at
// import time. Never real credentials.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/exit_keepa_test";
process.env.KEEPERHUB_API_KEY ??= "kh_test_key_not_real";
process.env.KEEPERHUB_WEBHOOK_SECRET ??= "test-webhook-secret-not-real-0000000000";
process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "error";
