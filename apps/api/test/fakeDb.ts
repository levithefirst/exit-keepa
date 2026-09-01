import crypto from "node:crypto";
import * as schema from "../src/db/schema";

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

// Maps each drizzle column object back to the JS field key it's assigned
// to on its table (e.g. schema.exitStrategies.safeId -> "safeId"), so the
// fake eq()/and() below can interpret real column references from the
// route code without reimplementing drizzle's query builder.
const colToField = new WeakMap<object, string>();
for (const table of Object.values(schema)) {
  if (table && typeof table === "object") {
    for (const [key, col] of Object.entries(table as Record<string, unknown>)) {
      if (col && typeof col === "object") colToField.set(col as object, key);
    }
  }
}

function fieldOf(col: unknown): string {
  const key = colToField.get(col as object);
  if (!key) throw new Error("fakeDb: unrecognized column reference in test");
  return key;
}

export function eq(col: unknown, value: unknown): Predicate {
  const field = fieldOf(col);
  return (row) => row[field] === value;
}

export function and(...preds: Predicate[]): Predicate {
  return (row) => preds.every((p) => p(row));
}

function applyInsertDefaults(table: unknown, values: Row): Row {
  const row: Row = { ...values };
  if (row.id === undefined) row.id = crypto.randomUUID();
  const now = new Date();
  if (row.createdAt === undefined) row.createdAt = now;
  if (table === schema.exitStrategies || table === schema.keeperhubExecutions) {
    if (row.updatedAt === undefined) row.updatedAt = now;
  }
  if (table === schema.exitStrategies && row.status === undefined) row.status = "draft";
  if (table === schema.exitStrategies && row.agentState === undefined) row.agentState = "normal";
  if (table === schema.exitStrategies && row.agentStateUpdatedAt === undefined) row.agentStateUpdatedAt = now;
  if (table === schema.keeperhubExecutions && row.status === undefined) row.status = "pending";
  if (table === schema.auditEvents && row.payload === undefined) row.payload = {};
  return row;
}

/**
 * Minimal in-memory stand-in for the drizzle `db` object, supporting only
 * the exact call shapes the routes actually use (select/insert/update with
 * where/limit/returning). Used to run route handlers end-to-end in tests
 * without a real Postgres instance.
 */
export function createFakeDb() {
  const tables = new Map<unknown, Row[]>();
  const rowsFor = (table: unknown) => {
    let rows = tables.get(table);
    if (!rows) {
      rows = [];
      tables.set(table, rows);
    }
    return rows;
  };

  function selectChain(table: unknown) {
    let predicate: Predicate | null = null;
    let limitN: number | undefined;
    const chain = {
      where(pred: Predicate) {
        predicate = pred;
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      then(resolve: (rows: Row[]) => void, reject?: (err: unknown) => void) {
        try {
          let rows = rowsFor(table);
          if (predicate) rows = rows.filter(predicate);
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          resolve(rows.map((r) => ({ ...r })));
        } catch (err) {
          reject?.(err);
        }
      },
    };
    return chain;
  }

  const db = {
    select() {
      return { from: (table: unknown) => selectChain(table) };
    },
    insert(table: unknown) {
      return {
        values(values: Row) {
          const row = applyInsertDefaults(table, values);
          return {
            returning() {
              rowsFor(table).push(row);
              return Promise.resolve([{ ...row }]);
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(pred: Predicate) {
          const rows = rowsFor(table);
          const remaining = rows.filter((r) => !pred(r));
          const deletedCount = rows.length - remaining.length;
          tables.set(table, remaining);
          return Promise.resolve({ rowCount: deletedCount });
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Row) {
          return {
            where(pred: Predicate) {
              return {
                returning() {
                  const rows = rowsFor(table);
                  const updated: Row[] = [];
                  for (let i = 0; i < rows.length; i++) {
                    if (pred(rows[i])) {
                      rows[i] = { ...rows[i], ...patch };
                      updated.push({ ...rows[i] });
                    }
                  }
                  return Promise.resolve(updated);
                },
              };
            },
          };
        },
      };
    },
  };

  return db;
}
