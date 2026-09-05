/**
 * The only Roles key Exit Keepa is allowed to use.
 *
 * Roles treats role names as bytes32 identifiers. Exit Keepa deliberately
 * exposes no user-controlled role-key input: this fixed label is the
 * authority used by registration, configuration, authorization verification,
 * and execution.
 */
export const EXIT_KEEPA_ROLE_NAME = "exit_keepa" as const;

/** `bytes32` UTF-8 representation of the fixed Exit Keepa role name. */
export const EXIT_KEEPA_ROLE_KEY =
  "0x657869745f6b6565706100000000000000000000000000000000000000000000" as const;

export function canonicalRoleKey(): typeof EXIT_KEEPA_ROLE_KEY {
  return EXIT_KEEPA_ROLE_KEY;
}
