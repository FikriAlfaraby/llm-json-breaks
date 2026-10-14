// Writes every broken reply to .cache/variants.jsonl and runs jsonrepair on each one:
//
//   node scripts/run.ts                 then   .venv/bin/python src/run_py.py   then   node scripts/score.ts
//
// The Python runner reads the same variants file, so both languages repair the same texts.
import { mkdirSync, writeFileSync } from "node:fs"

import { jsonrepair } from "jsonrepair"

import { variantsOf } from "../src/breaks.ts"
import { verdictKeys } from "../src/outcome.ts"
import { loadReplies } from "../src/replies.ts"

const CACHE = new URL("../.cache/", import.meta.url)
mkdirSync(CACHE, { recursive: true })

const variants = loadReplies().flatMap(variantsOf)
const lines: string[] = []
const repaired: string[] = []
const started = performance.now()
variants.forEach((v, i) => {
  lines.push(JSON.stringify({ i, reply: v.reply, break: v.break, at: v.at, text: v.text, verdictKeys: verdictKeys(v.value) }))
  let text: string
  try {
    text = jsonrepair(v.text)
  } catch (error) {
    repaired.push(JSON.stringify({ i, ok: false, error: (error as Error).message }))
    return
  }
  try {
    repaired.push(JSON.stringify({ i, ok: true, value: JSON.parse(text) as unknown }))
  } catch {
    // jsonrepair returned, but what it returned is still not JSON: count it, it is a library bug.
    repaired.push(JSON.stringify({ i, ok: false, error: `returned text that is not JSON: ${text.slice(0, 80)}` }))
  }
})
writeFileSync(new URL("variants.jsonl", CACHE), lines.join("\n") + "\n")
writeFileSync(new URL("jsonrepair.jsonl", CACHE), repaired.join("\n") + "\n")
console.log(`${variants.length} variants; jsonrepair took ${Math.round(performance.now() - started)} ms`)
