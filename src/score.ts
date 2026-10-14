import { BREAKS, type Break, type Variant } from "./breaks.ts"
import { outcomeOf, READERS, verdictKeys, type How, type Outcome, type Reader, type Reading, type Repaired } from "./outcome.ts"

export const LIBRARIES = {
  jsonrepair: "jsonrepair 3.15.0",
  json_repair: "json_repair 0.64.0",
  "json_repair-strict": "json_repair 0.64.0, strict=True",
} as const
export type Library = keyof typeof LIBRARIES

const EXAMPLES = 3 // per break and kind of change, so the file stays readable

interface Tally {
  right: number
  failReadAsPass: number
  passReadAsFail: number
  rejected: number
}

interface Example {
  reply: string
  at?: number
  text: string
  got: unknown
  how: string[]
}

/** Curly-quoted replies, split by whether their own text holds a curly quote. */
interface QuoteSplit {
  plain: Record<Outcome, number> & { cutAtComma: number }
  curly: Record<Outcome, number>
}

export interface Result {
  library: string
  variants: number
  curlyQuotes: QuoteSplit
  outcomes: Record<Break, Record<Outcome, number>>
  changes: Record<Break, Partial<Record<How, number>>>
  verdicts: Record<Break, Record<Reader, Tally>>
  examples: Record<Break, Record<string, Example[]>>
}

const short = (value: unknown) => {
  const text = JSON.stringify(value) ?? "undefined"
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

/**
 * Scores one library's repairs of every variant. `pydantic` is how pydantic read each verdict
 * (from src/run_py.py); without it, the pydantic column stays at zero.
 */
export function score(
  library: Library,
  variants: Variant[],
  repaired: (Repaired & { i: number })[],
  pydantic?: { i: number; read: Record<string, Reading> }[],
): Result {
  if (repaired.length !== variants.length || (pydantic && pydantic.length !== variants.length)) {
    throw new Error(`${library}: ${repaired.length} repairs and ${pydantic?.length} readings for ${variants.length} variants: run the runners again`)
  }
  const empty = <T>(make: () => T) => Object.fromEntries(BREAKS.map((b) => [b, make()])) as Record<Break, T>
  const result: Result = {
    library: LIBRARIES[library],
    variants: variants.length,
    outcomes: empty(() => ({ exact: 0, refused: 0, dropped: 0, changed: 0 })),
    changes: empty(() => ({})),
    verdicts: empty(() => Object.fromEntries([...Object.keys(READERS), "pydantic"].map((r) => [r, { right: 0, failReadAsPass: 0, passReadAsFail: 0, rejected: 0 }])) as Record<Reader, Tally>),
    examples: empty(() => ({})),
    curlyQuotes: { plain: { exact: 0, refused: 0, dropped: 0, changed: 0, cutAtComma: 0 }, curly: { exact: 0, refused: 0, dropped: 0, changed: 0 } },
  }
  variants.forEach((variant, i) => {
    const got = repaired[i]
    const read = pydantic?.[i]
    if (got?.i !== i || (pydantic && read?.i !== i)) throw new Error(`${library}: row ${i} is out of step`)
    const { outcome, differences } = outcomeOf(variant.value, got)
    result.outcomes[variant.break][outcome] += 1
    const kinds = [...new Set(differences.map((d) => d.how))]
    for (const how of kinds) result.changes[variant.break][how] = (result.changes[variant.break][how] ?? 0) + 1
    const label = outcome === "refused" ? "refused" : outcome === "changed" ? kinds.filter((k) => k !== "missing").join(" + ") : undefined
    if (label) {
      const list = (result.examples[variant.break][label] ??= [])
      if (list.length < EXAMPLES) {
        list.push({ reply: variant.reply, ...(variant.at === undefined ? {} : { at: variant.at }), text: variant.text, got: got.ok ? short(got.value) : got.error, how: differences.map((d) => `${d.path} ${d.how}`) })
      }
    }
    if (variant.break === "smart-quotes") {
      const side = textOf(variant.value).some((t) => CURLY.test(t)) ? "curly" : "plain"
      result.curlyQuotes[side][outcome] += 1
      if (side === "plain" && got.ok && differences.length > 0 && differences.every((d) => d.how === "text cut short" && cutBeforeComma(variant.value, got.value, d.path))) {
        result.curlyQuotes.plain.cutAtComma += 1
      }
    }
    const meant = variant.value as Record<string, boolean>
    for (const key of verdictKeys(variant.value)) {
      const readings: [Reader, Reading][] = [
        ...Object.entries(READERS).map(([name, reader]) => [name, got.ok ? reader(got.value, key) : "rejected"] as [Reader, Reading]),
      ]
      if (read) readings.push(["pydantic", read.read[key] ?? "rejected"])
      for (const [name, reading] of readings) {
        const tally = result.verdicts[variant.break][name]
        if (reading === "rejected") tally.rejected += 1
        else if (reading === meant[key]) tally.right += 1
        else if (reading) tally.failReadAsPass += 1
        else tally.passReadAsFail += 1
      }
    }
  })
  return result
}

const CURLY = /[“”‘’]/

function textOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value)
  else if (value && typeof value === "object") for (const v of Object.values(value)) textOf(v, out)
  return out
}

/** The value at a path like "$.urgency.citation" or "$.areas[1]". */
function at(value: unknown, path: string): unknown {
  return path
    .slice(1)
    .split(/\.|\[(\d+)\]/)
    .filter(Boolean)
    .reduce<unknown>((v, key) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), value)
}

/** The repaired text stops right where the meant text has a comma. */
function cutBeforeComma(meant: unknown, got: unknown, path: string): boolean {
  const whole = at(meant, path)
  const part = at(got, path)
  return typeof whole === "string" && typeof part === "string" && whole[part.length] === ","
}
