import { z } from "zod";
import { AAVE_V3_BASE } from "./protocols/aaveV3Base";

export const rateComparatorSchema = z.enum(["gt", "gte", "lt", "lte"]);

export const rateConditionSchema = z.object({
  market: z.string().min(1),
  metric: z.enum(["borrow_apr", "supply_apr", "utilization"]),
  comparator: rateComparatorSchema,
  thresholdBps: z.number().int().min(0).max(100_000),
});

/**
 * v1 only supports one action: withdraw Base USDC from Aave v3. The asset
 * is validated against the known Aave USDC reserve here so an invalid or
 * arbitrary asset can never reach strategy storage in the first place.
 */
export const exitActionSchema = z.object({
  protocol: z.literal("aave-v3-base"),
  action: z.literal("withdraw"),
  asset: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .refine((value) => value.toLowerCase() === AAVE_V3_BASE.usdc.toLowerCase(), {
      message: `Exit Keepa v1 only supports withdrawing Base USDC (${AAVE_V3_BASE.usdc})`,
    }),
  amount: z.union([z.literal("max"), z.string().regex(/^[1-9][0-9]*$/, "must be a positive integer string")]),
});

export const createExitStrategySchema = z.object({
  safeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  condition: rateConditionSchema,
  action: exitActionSchema,
});

export const createSafeAccountSchema = z.object({
  chainId: z.number().int().positive(),
  safeAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a checksummed EVM address"),
  rolesModifierAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullable()
    .optional(),
  rolesKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a bytes32 hex value")
    .nullable()
    .optional(),
});

export type CreateExitStrategyInput = z.infer<typeof createExitStrategySchema>;
export type CreateSafeAccountInput = z.infer<typeof createSafeAccountSchema>;
export type ExitActionInput = z.infer<typeof exitActionSchema>;
