/**
 * Off unless the web build sets SAFE_CREATION_ENABLED=true. next.config.mjs
 * inlines the value at build time, so turning it on is a web rebuild only:
 * nothing in the API reads it.
 */
export const SAFE_CREATION_ENABLED = process.env.SAFE_CREATION_ENABLED === "true";
