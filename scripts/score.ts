// Scores what each library handed back against what each model meant, and writes results/*.json,
// plus results/explorer.json: a few replies with what both libraries returned at every cut.
//
//   node scripts/score.ts           write the results
//   node scripts/score.ts --check   fail if a fresh run differs from the published results
import { readFileSync, writeFileSync } from "node:fs"

import { chars, variantsOf } from "../src/breaks.ts"
import type { Reading, Repaired } from "../src/outcome.ts"
import { loadReplies } from "../src/replies.ts"
import { LIBRARIES, score, type Library } from "../src/score.ts"

const CACHE = new URL("../.cache/", import.meta.url)
const RESULTS = new URL("../results/", import.meta.url)

/** The replies the site lets a reader cut, and where each one opens. */
const EXPLORER = [
  { id: "j0486", label: "A failing verdict, given first (GPT-6 Luna)", verdict: "pass", openAfter: '"pass": fa' },
  { id: "j0002", label: "A failing verdict after its reason, in a fence (Gemini 3.8 Flash)", verdict: "pass", openAfter: '"pass": fal' },
  { id: "x0012", label: "A lead's budget of Rp 1.5 billion (Gemini 3.8 Flash)", watch: { path: ["budgetIDR", "value"], label: "budgetIDR.value" }, openAfter: '"value": 15' },
]

function readLines<T>(name: string): T[] {
  return readFileSync(new URL(name, CACHE), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

const replies = loadReplies()
const variants = replies.flatMap(variantsOf)
const repaired = Object.fromEntries((Object.keys(LIBRARIES) as Library[]).map((l) => [l, readLines<Repaired & { i: number }>(`${l}.jsonl`)])) as Record<Library, (Repaired & { i: number })[]>

const outputs: [string, string][] = (Object.keys(LIBRARIES) as Library[]).map((library) => [
  `${library}.json`,
  JSON.stringify(score(library, variants, repaired[library], readLines<{ i: number; read: Record<string, Reading> }>(`pydantic-${library}.jsonl`)), null, 1) + "\n",
])

const index = new Map(variants.map((v, i) => [`${v.reply} ${v.break} ${v.at ?? ""}`, i]))
const explorer = EXPLORER.map(({ openAfter, ...pick }) => {
  const reply = replies.find((r) => r.id === pick.id)
  if (!reply) throw new Error(`no reply ${pick.id}`)
  const opens = reply.raw.indexOf(openAfter)
  if (opens < 0) throw new Error(`${pick.id} does not hold ${openAfter}`)
  const keep = (r: Repaired) => (r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error })
  const cuts = []
  for (let at = 1; at < chars(reply.raw).length; at++) {
    const i = index.get(`${reply.id} cut ${at}`)
    if (i === undefined) throw new Error(`no cut ${at} of ${reply.id}`)
    cuts.push({ jsonrepair: keep(repaired.jsonrepair[i] as Repaired), json_repair: keep(repaired.json_repair[i] as Repaired) })
  }
  return { ...pick, raw: reply.raw, meant: reply.value, start: chars(reply.raw.slice(0, opens + openAfter.length)).length, cuts }
})
outputs.push(["explorer.json", JSON.stringify({ replies: explorer }) + "\n"])

const check = process.argv.includes("--check")
let differs = false
for (const [name, text] of outputs) {
  const path = new URL(name, RESULTS)
  if (check) {
    if (readFileSync(path, "utf8") !== text) {
      differs = true
      console.error(`a fresh run differs from results/${name}`)
    } else console.log(`matches results/${name}`)
  } else {
    writeFileSync(path, text)
    console.log(`results/${name}`)
  }
}
if (differs) process.exit(1)
