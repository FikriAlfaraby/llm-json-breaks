import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { variantsOf } from "../src/breaks.ts"
import { loadReplies, unfence } from "../src/replies.ts"
import type { Result } from "../src/score.ts"

const replies = loadReplies()
const variants = replies.flatMap(variantsOf)
const published = (library: string) => JSON.parse(readFileSync(new URL(`../results/${library}.json`, import.meta.url), "utf8")) as Result
const jr = published("jsonrepair")
const py = published("json_repair")
const strict = published("json_repair-strict")
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ")
const n = (x: number) => x.toLocaleString("en-US")
const count = (b: string) => variants.filter((v) => v.break === b).length
const says = (claim: string) => assert.ok(readme.includes(claim), `the README does not say: ${claim}`)

describe("the README", () => {
  it("quotes the corpus as it is", () => {
    const verdicts = replies.filter((r) => typeof (r.value as { pass?: unknown }).pass === "boolean")
    says(`${n(replies.length)} real LLM replies`)
    says(`${n(variants.length)} broken replies`)
    says(`${n(replies.filter((r) => r.kind === "judge").length)} verdicts from LLM judges`)
    says(`${n(replies.filter((r) => r.raw !== unfence(r.raw)).length)} arrived inside`)
    says(`${n(verdicts.length)} carry a true/false verdict`)
    says(`all ${n(replies.filter((r) => r.raw !== unfence(r.raw) && r.model === "gemini-3.8-flash").length)} replies that Gemini sent inside`)
  })

  it("quotes the cut false read as a pass", () => {
    const failing = replies.filter((r) => (r.value as { pass?: unknown }).pass === false).length
    const flips = jr.verdicts.cut.truthy.failReadAsPass
    assert.equal(flips, 4 * failing)
    for (const r of [py, strict]) assert.equal(r.verdicts.cut.truthy.failReadAsPass, flips)
    for (const r of [jr, py, strict]) for (const reader of ["strict", "zod", "pydantic"] as const) assert.equal(r.verdicts.cut[reader].failReadAsPass, 0)
    says(`${n(flips)} cut points, four in each of the ${n(failing)} failing verdicts, read as passes`)
  })

  it("quotes the arrays, the curly quotes and strict mode", () => {
    for (const b of ["prose", "twice"] as const) {
      assert.equal(jr.changes[b]["an array, not the object"], count(b))
      assert.equal(py.outcomes[b].exact, count(b))
      assert.equal(strict.outcomes[b].refused, count(b))
    }
    assert.equal(jr.outcomes["prose-inline"].refused, count("prose-inline"))
    assert.equal(py.outcomes["prose-inline"].exact, count("prose-inline"))
    assert.equal(strict.outcomes["prose-inline"].refused, count("prose-inline"))
    says(`all ${n(count("prose"))} come back as an array`)
    says("| the same sentences on the JSON's line | 2,028 | all refused | exact | all refused |")
    const plain = py.curlyQuotes.plain
    const { commaThenMore, noCommaThenMore } = py.curlyQuotes
    assert.equal(commaThenMore.replies + noCommaThenMore.replies, plain.exact + plain.changed + plain.refused + plain.dropped)
    assert.equal(jr.curlyQuotes.plain.exact, commaThenMore.replies + noCommaThenMore.replies)
    says(`${n(jr.curlyQuotes.plain.exact)} replies had no curly double quote in their own text`)
    says(`In the ${n(commaThenMore.replies)} of them where a string holding a comma has another value after it, json_repair changed ${n(commaThenMore.notExact)}; in the other ${n(noCommaThenMore.replies)}, it changed ${n(noCommaThenMore.notExact)}`)
    says(`jsonrepair returned all ${n(jr.curlyQuotes.plain.exact)} exactly`)
    assert.equal(jr.curlyQuotes.curly.exact, 0, "every curly-quoted reply jsonrepair changed or refused had a curly quote in its text")
    says(`| as sent (control) | ${n(count("as-sent"))} | ${n(jr.outcomes["as-sent"].exact)} exact | ${n(py.outcomes["as-sent"].exact)} exact | ${n(strict.outcomes["as-sent"].refused)} refused (fenced) |`)
    const row = (r: Result, b: "smart-quotes" | "inner-quotes") =>
      Object.entries(r.outcomes[b])
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${n(v)} ${k}`)
        .join(", ")
    says(`| curly quotes | ${n(count("smart-quotes"))} | ${row(jr, "smart-quotes")} | ${row(py, "smart-quotes")} | ${row(strict, "smart-quotes")} |`)
    says(`| unescaped inner quotes | ${n(count("inner-quotes"))} | ${row(jr, "inner-quotes")} | ${row(py, "inner-quotes")} | ${row(strict, "inner-quotes")} |`)
    says(`jsonrepair returned ${n(jr.outcomes["inner-quotes"].exact)} exactly and refused ${n(jr.outcomes["inner-quotes"].refused)}`)
    says(`json_repair changed ${n(py.outcomes["inner-quotes"].changed)}, and in ${n(py.verdicts["inner-quotes"].zod.rejected)} of them the verdict field disappeared into a made-up key, turning ${n(py.verdicts["inner-quotes"].truthy.passReadAsFail)} passes into fails`)
    for (const b of ["trailing-comma", "comment", "python", "raw-newline", "missing-comma"] as const) {
      for (const r of [jr, py, strict]) assert.equal(r.outcomes[b].exact, count(b), `${r.library} ${b}`)
    }
    const nested = replies.filter((r) => Object.values(r.value as object).some((x) => x && typeof x === "object"))
    says(`${n(nested.length)} are nested (${n(nested.filter((r) => r.kind === "judge").length)} judge replies about message drafts and the ${n(nested.filter((r) => r.kind === "extraction").length)} from wa-lead)`)
  })

  it("quotes the cut table", () => {
    const cells = (key: "refused" | "exact" | "dropped" | "changed") => [jr, py, strict].map((r) => n(r.outcomes.cut[key])).join(" | ")
    says(`${n(count("cut"))} cut points`)
    says(`| refused | ${cells("refused")} |`)
    says(`| valid JSON, the meant value | ${cells("exact")} |`)
    says(`| valid JSON, fields left out, the rest right | ${cells("dropped")} |`)
    says(`| valid JSON, a value changed | ${cells("changed")} |`)
    const share = (r: Result) => Math.round((100 * r.outcomes.cut.refused) / count("cut"))
    says(`jsonrepair refused ${share(jr)}%`)
    says(`strict mode ${share(strict)}%`)
    says(`jsonrepair does refuse some cuts: ${n(jr.outcomes.cut.refused)}`)
    says(`refused ${n(jr.outcomes["inner-quotes"].refused)} of ${n(count("inner-quotes"))} replies with unescaped inner quotes`)
    says(`returned ${n(jr.outcomes["inner-quotes"].exact)} exactly`)
    says(`it changed ${n(py.outcomes["smart-quotes"].changed)}`)
    // A cut inside the closing fence, after the JSON is complete: two positions per fenced reply.
    assert.equal(jr.changes.cut["an array, not the object"], 2 * replies.filter((r) => r.raw !== unfence(r.raw)).length)
    assert.ok((py.changes.cut["an array, not the object"] ?? 0) > 0)
    says("Four were wrong in part")
  })
})

describe("the README on streaming parsers", () => {
  const STREAMING = {
    "ai-sdk": "| Vercel AI SDK, `parsePartialJson` | finished as `false` | kept: 15 for 1,500,000,000 | kept, cut short | `repaired-parse` | fails on every cut |",
    "partial-json": "| partial-json | finished | kept | kept | no | fails |",
    "langchain-js": "| LangChain JS, `parsePartialJson` | finished | kept | kept | no | fails |",
    "openai-sdk": "| OpenAI SDK's parser | finished | left out | kept | no | fails |",
    "anthropic-sdk": "| Anthropic SDK's parser | left out | left out | left out | no | reads through it |",
    "jiter-on": '| jiter, `partial_mode="on"` | left out | kept | left out | no | fails |',
    "jiter-trailing-strings": '| jiter, `"trailing-strings"` | left out | kept | kept | no | fails |',
    "langchain-py": "| langchain-core (Python) | left out | kept | kept | no | fails |",
  } as const
  const fenced = replies.filter((r) => r.raw !== unfence(r.raw))
  const fencedCuts = variants.filter((v) => v.break === "cut" && fenced.some((r) => r.id === v.reply)).length

  it("has one table row per parser, and each cell follows from that parser's results", () => {
    says(`same ${n(count("cut"))} cut points through seven of these parsers, jiter in two modes: eight settings`)
    for (const [library, row] of Object.entries(STREAMING)) {
      says(row)
      const r = published(library)
      const cells = row.split(" | ").slice(1).map((c) => c.replace(/ \|$/, ""))
      const [falseCell = "", numberCell = "", textCell = "", saysCell = "", fenceCell = ""] = cells
      const lit = r.literalCuts
      assert.equal(lit.text, 0, `${library} returns no cut true/false as text`)
      if (falseCell.startsWith("finished")) assert.ok(lit.finished > 0 && lit.leftOut === 0, library)
      else assert.ok(falseCell === "left out" && lit.leftOut > 0 && lit.finished === 0, library)
      const numbers = Object.values(r.numbersCut).reduce((a, x) => a + x, 0)
      assert.equal(numberCell.startsWith("kept"), numbers > 0, `${library} cut numbers`)
      assert.equal(textCell.startsWith("kept"), (r.changes.cut["text cut short"] ?? 0) > 0, `${library} cut text`)
      assert.equal(saysCell !== "no", r.states !== undefined, `${library} says it guessed`)
      if (fenceCell.startsWith("fails")) assert.equal(r.cutFenced.refused, fencedCuts, library)
      else assert.equal(r.cutFenced.refused, 8 * fenced.length, `${library} refuses only inside the opening fence`)
    }
  })

  it("quotes the bullets under the table", () => {
    const literals = jr.literalCuts.finished + jr.literalCuts.leftOut + jr.literalCuts.text + jr.literalCuts.other + jr.literalCuts.refused
    for (const r of [jr, py]) assert.equal(r.literalCuts.text, literals)
    says(`Of ${n(literals)} cut points inside a top-level \`true\` or \`false\`, no streaming parser returned the fragment as text; both repair libraries returned all ${n(literals)} as text`)
    const ai = published("ai-sdk")
    const budgets = replies.filter((r) => typeof (r.value as { budgetIDR?: { value?: unknown } }).budgetIDR?.value === "number").length
    says(`${n(ai.numbersCut["$.budgetIDR.value"] ?? 0)} cut points inside the ${n(budgets)} budgets`)
    const anthropic = published("anthropic-sdk")
    assert.equal(anthropic.outcomes.cut.changed, 0)
    says(`${n(anthropic.outcomes.cut.dropped)} cut points with fields left out, none with a wrong value`)
    const read = count("cut") - ai.outcomes.cut.refused
    assert.equal(ai.states?.cut?.["repaired-parse"], read)
    assert.equal(ai.states?.cut?.["successful-parse"], undefined)
    says(`\`repaired-parse\` on all ${n(read)} cuts it could read`)
    says(`failed on every cut, ${n(fencedCuts)} cut points, and on the finished reply`)
    says("refused only the 8 cut points before each reply's opening brace")
    says(`on unescaped inner quotes it changed ${n(anthropic.outcomes["inner-quotes"].changed)} replies`)
    assert.equal(ai.outcomes["as-sent"].refused, fenced.length)
  })
})
