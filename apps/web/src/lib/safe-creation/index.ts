/**
 * The one entry the dashboard loads, on demand, when someone clicks Create
 * Safe. Protocol Kit and viem stay out of the page bundle until then.
 */
export { createFlowDeps } from "./clients";
export { FlowError, toFlowError } from "./errors";
export { deploySafe, prepareSafe } from "./flow";
export { ensureBaseChain, getCurrentAccount } from "./wallet";
