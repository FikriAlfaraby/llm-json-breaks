import { unfence, type Reply } from "./replies.ts"

/**
 * The ways a model's JSON reply arrives broken. Each break takes a recorded reply and returns the
 * text a repair library would get, with the value the model meant. "as-sent" is the control: the
 * reply exactly as recorded, which must come back unchanged.
 */
export const BREAKS = [
  "as-sent",
  "cut",
  "fence",
  "prose",
  "trailing-comma",
  "comment",
  "python",
  "smart-quotes",
  "raw-newline",
  "inner-quotes",
  "missing-comma",
  "twice",
] as const
export type Break = (typeof BREAKS)[number]

export const ABOUT: Record<Break, string> = {
  "as-sent": "the reply exactly as recorded (some arrived inside a ```json fence)",
  cut: "the reply stopped after every character in turn, like a max_tokens stop",
  fence: "wrapped in a ```json fence",
  prose: "a sentence before the JSON and one after it",
  "trailing-comma": "a comma after the last value",
  comment: "a // comment after the first value",
  python: "written as a Python dict: True, False, None and single quotes",
  "smart-quotes": "curly quotes around every key and string",
  "raw-newline": "a line break typed inside a string instead of \\n",
  "inner-quotes": "a word in a string quoted with unescaped double quotes",
  "missing-comma": "the comma between the first two fields left out",
  twice: "the whole reply written twice",
}

export interface Variant {
  reply: string
  break: Break
  /** For a cut: how many characters (code points) of the reply survived. */
  at?: number
  text: string
  /** What the model meant. A repair is exact when it returns this. */
  value: unknown
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Code points, so a cut never splits an emoji, and Python counts the same positions. */
export function chars(text: string): string[] {
  return Array.from(text)
}

export function cuts(reply: Reply): Variant[] {
  const all = chars(reply.raw)
  const out: Variant[] = []
  for (let at = 1; at < all.length; at++) {
    out.push({ reply: reply.id, break: "cut", at, text: all.slice(0, at).join(""), value: reply.value })
  }
  return out
}

/** Every string inside a value, with a function that puts a new string in its place. */
function strings(value: Json, set: (next: Json) => void, out: { text: string; replace: (s: string) => void }[]): void {
  if (typeof value === "string") out.push({ text: value, replace: (s) => set(s) })
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, (next) => (value[i] = next), out))
  else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) strings(value[key] ?? null, (next) => (value[key] = next), out)
  }
}

/** The longest string of at least `words` words, ties broken by position: the reason, usually. */
function longestString(value: Json, words: number): { text: string; replace: (s: string) => void } | undefined {
  const found: { text: string; replace: (s: string) => void }[] = []
  strings(value, () => undefined, found)
  return found
    .filter((s) => s.text.split(" ").length >= words)
    .reduce<(typeof found)[number] | undefined>((best, s) => (!best || s.text.length > best.text.length ? s : best), undefined)
}

const clone = (value: unknown): Json => structuredClone(value) as Json

/** Python's repr of a string: single quotes unless the text holds one and no double quote. */
function pyString(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  const body = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replaceAll(quote, `\\${quote}`)
  return quote + body + quote
}

export function pythonRepr(value: Json): string {
  if (value === null) return "None"
  if (value === true) return "True"
  if (value === false) return "False"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return pyString(value)
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(", ")}]`
  return `{${Object.entries(value)
    .map(([k, v]) => `${pyString(k)}: ${pythonRepr(v)}`)
    .join(", ")}}`
}

/** JSON with every key and string between curly quotes. Quotes inside the text stay escaped. */
export function smartQuotes(value: Json): string {
  const str = (s: string) => `“${JSON.stringify(s).slice(1, -1)}”`
  const walk = (v: Json): string => {
    if (typeof v === "string") return str(v)
    if (v === null || typeof v !== "object") return JSON.stringify(v)
    if (Array.isArray(v)) return `[${v.map(walk).join(", ")}]`
    return `{${Object.entries(v)
      .map(([k, x]) => `${str(k)}: ${walk(x)}`)
      .join(", ")}}`
  }
  return walk(value)
}

// Placeholders that JSON.stringify writes as \u0000…, swapped for the raw character afterwards.
const NEWLINE = "\u0000n\u0000"
const QUOTE = "\u0000q\u0000"
const escaped = (marker: string) => JSON.stringify(marker).slice(1, -1)

/** One string's middle space typed as a real line break. */
function rawNewline(reply: Reply): Variant | undefined {
  const value = clone(reply.value)
  const target = longestString(value, 2)
  if (!target) return undefined
  const spaces = [...target.text.matchAll(/ /g)].map((m) => m.index)
  const middle = spaces.reduce((best, i) => (Math.abs(i - target.text.length / 2) < Math.abs(best - target.text.length / 2) ? i : best))
  const meant = target.text.slice(0, middle) + "\n" + target.text.slice(middle + 1)
  target.replace(target.text.slice(0, middle) + NEWLINE + target.text.slice(middle + 1))
  const text = JSON.stringify(value).replace(escaped(NEWLINE), "\n")
  target.replace(meant)
  return { reply: reply.id, break: "raw-newline", text, value }
}

/** One string's middle word put in double quotes the model forgot to escape. */
function innerQuotes(reply: Reply): Variant | undefined {
  const value = clone(reply.value)
  const target = longestString(value, 3)
  if (!target) return undefined
  const words = target.text.split(" ")
  const i = Math.floor(words.length / 2)
  const marked = words.map((w, j) => (j === i ? `${QUOTE}${w}${QUOTE}` : w)).join(" ")
  target.replace(marked)
  const text = JSON.stringify(value).replaceAll(escaped(QUOTE), '"')
  target.replace(marked.replaceAll(QUOTE, '"'))
  return { reply: reply.id, break: "inner-quotes", text, value }
}

/** Pretty-printed, with the comma after the first field missing. */
function missingComma(reply: Reply): Variant | undefined {
  const value = reply.value as Json
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length < 2) return undefined
  const [first, ...rest] = Object.entries(value).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v, null, 2).replace(/\n/g, "\n  ")}`)
  return { reply: reply.id, break: "missing-comma", text: `{\n${first}\n${rest.join(",\n")}\n}`, value: reply.value }
}

/** Pretty-printed, with a // comment after the first field's value. */
function comment(reply: Reply): Variant | undefined {
  const value = reply.value as Json
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length < 1) return undefined
  const pretty = JSON.stringify(value, null, 2).split("\n")
  // The first field ends on the first line, at depth one, that ends with a comma.
  const line = pretty.findIndex((l, i) => i > 0 && /^ {2}\S/.test(l) && l.endsWith(","))
  if (line < 0) return undefined
  pretty[line] += " // as the reply says"
  return { reply: reply.id, break: "comment", text: pretty.join("\n"), value: reply.value }
}

function trailingComma(reply: Reply): Variant | undefined {
  const json = unfence(reply.raw).trimEnd()
  if (!json.endsWith("}") && !json.endsWith("]")) return undefined
  const close = json.length - 1
  const body = json.slice(0, close).trimEnd()
  return { reply: reply.id, break: "trailing-comma", text: `${body},${json.slice(body.length)}`, value: reply.value }
}

/** Every break of one reply except the cuts. */
export function breaksOf(reply: Reply): Variant[] {
  const json = unfence(reply.raw)
  const fenced = json !== reply.raw
  const one = (b: Break, text: string): Variant => ({ reply: reply.id, break: b, text, value: reply.value })
  return [
    one("as-sent", reply.raw),
    fenced ? undefined : one("fence", "```json\n" + json + "\n```"),
    one("prose", `Here is my assessment:\n\n${json}\n\nLet me know if you need anything else.`),
    trailingComma(reply),
    comment(reply),
    one("python", pythonRepr(reply.value as Json)),
    one("smart-quotes", smartQuotes(reply.value as Json)),
    rawNewline(reply),
    innerQuotes(reply),
    missingComma(reply),
    one("twice", `${json}\n${json}`),
  ].filter((v): v is Variant => v !== undefined)
}

export function variantsOf(reply: Reply): Variant[] {
  return [...breaksOf(reply), ...cuts(reply)]
}
