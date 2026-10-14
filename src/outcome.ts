import { z } from "zod"

/** What a library handed back for one broken reply. */
export type Repaired = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * exact: the value the model meant. refused: the library raised an error, so the caller knows.
 * dropped: some fields or items are missing, and everything that is there is right.
 * changed: valid JSON that says something the model did not.
 */
export type Outcome = "exact" | "refused" | "dropped" | "changed"

export type How =
  | "missing"
  | "extra"
  | "text cut short"
  | "text changed"
  | "number changed"
  | "true, false or null became text"
  | "became null"
  | "type changed"
  | "not the object"

export interface Difference {
  path: string
  how: How
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const LITERALS = ["true", "false", "null"]

/** Where `got` says something other than `meant`, field by field. */
export function differences(meant: unknown, got: unknown, path = "$"): Difference[] {
  if (Object.is(meant, got) || meant === got) return []
  if (isObject(meant) && isObject(got)) {
    const out: Difference[] = []
    for (const key of Object.keys(meant)) {
      if (key in got) out.push(...differences(meant[key], got[key], `${path}.${key}`))
      else out.push({ path: `${path}.${key}`, how: "missing" })
    }
    for (const key of Object.keys(got)) if (!(key in meant)) out.push({ path: `${path}.${key}`, how: "extra" })
    return out
  }
  if (Array.isArray(meant) && Array.isArray(got)) {
    const out: Difference[] = []
    for (let i = 0; i < Math.max(meant.length, got.length); i++) {
      if (i >= got.length) out.push({ path: `${path}[${i}]`, how: "missing" })
      else if (i >= meant.length) out.push({ path: `${path}[${i}]`, how: "extra" })
      else out.push(...differences(meant[i], got[i], `${path}[${i}]`))
    }
    return out
  }
  if (path === "$" && (isObject(meant) || Array.isArray(meant))) return [{ path, how: "not the object" }]
  if (typeof meant === "string" && typeof got === "string") {
    return [{ path, how: got.length < meant.length && meant.startsWith(got) ? "text cut short" : "text changed" }]
  }
  if (typeof meant === "number" && typeof got === "number") return [{ path, how: "number changed" }]
  if ((typeof meant === "boolean" || meant === null) && typeof got === "string" && LITERALS.some((l) => got !== "" && l.startsWith(got.toLowerCase()))) {
    return [{ path, how: "true, false or null became text" }]
  }
  if (got === null) return [{ path, how: "became null" }]
  return [{ path, how: "type changed" }]
}

export function outcomeOf(meant: unknown, repaired: Repaired): { outcome: Outcome; differences: Difference[] } {
  if (!repaired.ok) return { outcome: "refused", differences: [] }
  const found = differences(meant, repaired.value)
  if (found.length === 0) return { outcome: "exact", differences: [] }
  return { outcome: found.every((d) => d.how === "missing") ? "dropped" : "changed", differences: found }
}

/** The fields of a judge reply that carry its verdict as true or false. */
export function verdictKeys(value: unknown): string[] {
  return isObject(value) ? Object.keys(value).filter((k) => typeof value[k] === "boolean") : []
}

/** What a caller concludes from one verdict field: true, false, or an error it can see. */
export type Reading = boolean | "rejected"

/**
 * Three ways code reads a verdict. "truthy" is `if (result.pass)` in JavaScript or Python.
 * "strict" is `result.pass === true`. "zod" is a schema that wants a boolean. (pydantic, which
 * accepts "f" and "t" as booleans, is read in Python: src/run_py.py.)
 */
export const READERS = {
  truthy: (value: unknown, key: string): Reading => Boolean(isObject(value) ? value[key] : undefined),
  strict: (value: unknown, key: string): Reading => isObject(value) && value[key] === true,
  zod: (value: unknown, key: string): Reading => {
    const read = schemaFor(key).safeParse(value)
    return read.success ? (read.data[key] as boolean) : "rejected"
  },
} as const

const schemas = new Map<string, z.ZodType<Record<string, boolean>>>()
function schemaFor(key: string): z.ZodType<Record<string, boolean>> {
  let schema = schemas.get(key)
  if (!schema) schemas.set(key, (schema = z.object({ [key]: z.boolean() })))
  return schema
}
export type Reader = keyof typeof READERS | "pydantic"
