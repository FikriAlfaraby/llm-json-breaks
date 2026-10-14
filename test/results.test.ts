import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { jsonrepair } from "jsonrepair"

import { BREAKS, variantsOf } from "../src/breaks.ts"
import type { Repaired } from "../src/outcome.ts"
import { loadReplies } from "../src/replies.ts"
import { LIBRARIES, score, type Result } from "../src/score.ts"

const variants = loadReplies().flatMap(variantsOf)
const published = (library: string) => JSON.parse(readFileSync(new URL(`../results/${library}.json`, import.meta.url), "utf8")) as Result

describe("the published results", () => {
  it("count every variant once, for every library", () => {
    for (const library of Object.keys(LIBRARIES)) {
      const result = published(library)
      assert.equal(result.variants, variants.length, library)
      for (const b of BREAKS) {
        const n = variants.filter((v) => v.break === b).length
        assert.equal(Object.values(result.outcomes[b]).reduce((sum, x) => sum + x, 0), n, `${library} ${b}`)
      }
    }
  })

  it("follow from running jsonrepair again on every variant", () => {
    const repaired = variants.map((v, i): Repaired & { i: number } => {
      try {
        return { i, ok: true, value: JSON.parse(jsonrepair(v.text)) as unknown }
      } catch (error) {
        return { i, ok: false, error: (error as Error).message }
      }
    })
    const fresh = score("jsonrepair", variants, repaired)
    const result = published("jsonrepair")
    assert.deepEqual(fresh.outcomes, result.outcomes)
    assert.deepEqual(fresh.changes, result.changes)
    for (const b of BREAKS) {
      for (const reader of ["truthy", "strict", "zod"] as const) assert.deepEqual(fresh.verdicts[b][reader], result.verdicts[b][reader], `${b} ${reader}`)
    }
  })
})
