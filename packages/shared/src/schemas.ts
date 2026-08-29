import { z } from "zod";

export const rateComparatorSchema = z.enum(["gt", "gte", "lt", "lte"]);

export const rateConditionSchema = z.object({
  market: z.string().min(1),
  metric: z.enum(["borrow_apr", "supply_apr", "utilization"]),
  comparator: rateComparatorSchema,
  thresholdBps: z.number().int().min(0).max(100_000),
});

export const createExitStrategySchema = z.object({
  safeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  condition: rateConditionSchema,
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
});

export type CreateExitStrategyInput = z.infer<typeof createExitStrategySchema>;
export type CreateSafeAccountInput = z.infer<typeof createSafeAccountSchema>;
