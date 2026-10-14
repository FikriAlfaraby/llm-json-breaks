// Scores what each library handed back against what each model meant, and writes results/*.json.
//
//   node scripts/score.ts           write the results
//   node scripts/score.ts --check   fail if a fresh run differs from the published results
import { readFileSync, writeFileSync } from "node:fs"

import { variantsOf } from "../src/breaks.ts"
import type { Reading, Repaired } from "../src/outcome.ts"
import { loadReplies } from "../src/replies.ts"
import { LIBRARIES, score, type Library } from "../src/score.ts"

const CACHE = new URL("../.cache/", import.meta.url)
const RESULTS = new URL("../results/", import.meta.url)

function readLines<T>(name: string): T[] {
  return readFileSync(new URL(name, CACHE), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

const variants = loadReplies().flatMap(variantsOf)
const check = process.argv.includes("--check")
let differs = false
for (const library of Object.keys(LIBRARIES) as Library[]) {
  const text = JSON.stringify(
    score(library, variants, readLines<Repaired & { i: number }>(`${library}.jsonl`), readLines<{ i: number; read: Record<string, Reading> }>(`pydantic-${library}.jsonl`)),
    null,
    1,
  ) + "\n"
  const path = new URL(`${library}.json`, RESULTS)
  if (check) {
    const published = readFileSync(path, "utf8")
    if (published !== text) {
      differs = true
      console.error(`${library}: a fresh run differs from results/${library}.json`)
    } else console.log(`${library}: matches results/${library}.json`)
  } else {
    writeFileSync(path, text)
    console.log(`results/${library}.json`)
  }
}
if (differs) process.exit(1)
