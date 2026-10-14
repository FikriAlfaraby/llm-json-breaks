// Writes every broken reply to .cache/variants.jsonl and runs the JavaScript libraries on each one:
//
//   node scripts/run.ts                 then   .venv/bin/python src/run_py.py   then   node scripts/score.ts
//
// The Python runner reads the same variants file, so both languages parse the same texts.
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

import { partialParse as anthropicParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser.js"
import { parsePartialJson as langchainParse } from "@langchain/core/output_parsers"
import { parsePartialJson as aiSdkParse } from "ai"
import { jsonrepair } from "jsonrepair"
import { partialParse as openaiParse } from "openai/_vendor/partial-json-parser/parser.js"

import { variantsOf } from "../src/breaks.ts"
import { verdictKeys } from "../src/outcome.ts"
import { loadReplies } from "../src/replies.ts"

const require = createRequire(import.meta.url)
const { parse: partialJson } = require("partial-json") as { parse: (text: string) => unknown }

const CACHE = new URL("../.cache/", import.meta.url)
mkdirSync(CACHE, { recursive: true })

type Row = { ok: true; value: unknown; state?: string } | { ok: false; error: string; state?: string }

/** Each library, as an app would call it on a reply or on what has streamed so far. */
const LIBRARIES: Record<string, (text: string) => Row | Promise<Row>> = {
  jsonrepair: (text) => {
    const repaired = jsonrepair(text)
    try {
      return { ok: true, value: JSON.parse(repaired) as unknown }
    } catch {
      // jsonrepair returned, but what it returned is still not JSON: count it, it is a library bug.
      return { ok: false, error: `returned text that is not JSON: ${repaired.slice(0, 80)}` }
    }
  },
  "ai-sdk": async (text) => {
    const { value, state } = await aiSdkParse(text)
    return value === undefined ? { ok: false, error: state, state } : { ok: true, value, state }
  },
  "partial-json": (text) => ({ ok: true, value: partialJson(text) }),
  // LangChain returns null when it cannot read the text; every reply here means an object.
  "langchain-js": (text) => {
    const value = langchainParse(text) as unknown
    return value === null ? { ok: false, error: "returned null" } : { ok: true, value }
  },
  "anthropic-sdk": (text) => ({ ok: true, value: anthropicParse(text) as unknown }),
  "openai-sdk": (text) => ({ ok: true, value: openaiParse(text) as unknown }),
}

const variants = loadReplies().flatMap(variantsOf)
writeFileSync(
  new URL("variants.jsonl", CACHE),
  variants.map((v, i) => JSON.stringify({ i, reply: v.reply, break: v.break, at: v.at, text: v.text, verdictKeys: verdictKeys(v.value) })).join("\n") + "\n",
)
for (const [name, parse] of Object.entries(LIBRARIES)) {
  const started = performance.now()
  const rows: string[] = []
  for (const [i, v] of variants.entries()) {
    let row: Row
    try {
      row = await parse(v.text)
    } catch (error) {
      row = { ok: false, error: (error as Error).message.slice(0, 200) }
    }
    rows.push(JSON.stringify({ i, ...row }))
  }
  writeFileSync(new URL(`${name}.jsonl`, CACHE), rows.join("\n") + "\n")
  console.log(`${name}: ${variants.length} variants in ${Math.round(performance.now() - started)} ms`)
}
