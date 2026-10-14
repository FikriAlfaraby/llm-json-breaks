import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { breaksOf, chars, cuts, pythonRepr, smartQuotes, type Variant } from "../src/breaks.ts"
import { unfence, type Reply } from "../src/replies.ts"

const judge: Reply = {
  id: "j0001",
  source: "test",
  model: "test",
  kind: "judge",
  sent: "as sent",
  raw: '{"pass": false, "reason": "It names the wrong team, not the Broncos."}',
  value: { pass: false, reason: "It names the wrong team, not the Broncos." },
}
const fenced: Reply = { ...judge, id: "j0002", raw: "```json\n" + judge.raw + "\n```" }
const byBreak = (reply: Reply) => new Map(breaksOf(reply).map((v) => [v.break, v] as [string, Variant]))

describe("the breaks", () => {
  it("parse back to the meant value whenever the break leaves valid JSON", () => {
    const v = byBreak(judge)
    for (const name of ["as-sent"]) assert.deepEqual(JSON.parse(v.get(name)?.text ?? ""), judge.value, name)
    assert.deepEqual(JSON.parse(unfence(v.get("fence")?.text ?? "")), judge.value)
  })

  it("break what they say, and nothing else", () => {
    const v = byBreak(judge)
    assert.equal(v.get("fence")?.text, '```json\n{"pass": false, "reason": "It names the wrong team, not the Broncos."}\n```')
    assert.equal(v.get("prose")?.text, `Here is my assessment:\n\n${judge.raw}\n\nLet me know if you need anything else.`)
    assert.equal(v.get("trailing-comma")?.text, '{"pass": false, "reason": "It names the wrong team, not the Broncos.",}')
    assert.equal(v.get("comment")?.text, '{\n  "pass": false, // as the reply says\n  "reason": "It names the wrong team, not the Broncos."\n}')
    assert.equal(v.get("python")?.text, "{'pass': False, 'reason': 'It names the wrong team, not the Broncos.'}")
    assert.equal(v.get("smart-quotes")?.text, "{“pass”: false, “reason”: “It names the wrong team, not the Broncos.”}")
    assert.equal(v.get("missing-comma")?.text, '{\n  "pass": false\n  "reason": "It names the wrong team, not the Broncos."\n}')
    assert.equal(v.get("twice")?.text, `${judge.raw}\n${judge.raw}`)
  })

  it("type a real line break into the middle of the longest string, and mean it", () => {
    const v = byBreak(judge).get("raw-newline")
    assert.equal(v?.text, '{"pass":false,"reason":"It names the wrong\nteam, not the Broncos."}')
    assert.deepEqual(v?.value, { pass: false, reason: "It names the wrong\nteam, not the Broncos." })
  })

  it("quote the middle word of the longest string without escaping, and mean the quotes", () => {
    const v = byBreak(judge).get("inner-quotes")
    assert.equal(v?.text, '{"pass":false,"reason":"It names the wrong "team," not the Broncos."}')
    assert.deepEqual(v?.value, { pass: false, reason: 'It names the wrong "team," not the Broncos.' })
  })

  it("do not fence a reply twice, and break the JSON inside a fenced one", () => {
    const v = byBreak(fenced)
    assert.equal(v.has("fence"), false)
    assert.equal(v.get("as-sent")?.text, fenced.raw)
    assert.equal(v.get("prose")?.text, `Here is my assessment:\n\n${judge.raw}\n\nLet me know if you need anything else.`)
  })

  it("leave the recorded reply untouched", () => {
    const before = structuredClone(judge.value)
    breaksOf(judge)
    assert.deepEqual(judge.value, before)
  })
})

describe("the cuts", () => {
  it("stop after every character but the last, keeping what the model meant", () => {
    const all = cuts(judge)
    assert.equal(all.length, chars(judge.raw).length - 1)
    assert.deepEqual(all.map((v) => v.at), all.map((_, i) => i + 1))
    assert.equal(all[17]?.text, '{"pass": false, "r')
    for (const v of all) assert.deepEqual(v.value, judge.value)
  })

  it("count code points, so an emoji is never split", () => {
    const emoji: Reply = { ...judge, raw: '{"a": "🙂"}', value: { a: "🙂" } }
    assert.deepEqual(cuts(emoji).map((v) => v.text).slice(6, 9), ['{"a": "', '{"a": "🙂', '{"a": "🙂"'])
  })
})

describe("Python's repr", () => {
  it("picks quotes the way Python does", () => {
    assert.equal(pythonRepr({ a: "it's", b: 'say "hi"', c: `both ' and "` }), `{'a': "it's", 'b': 'say "hi"', 'c': 'both \\' and "'}`)
    assert.equal(pythonRepr([true, false, null, 1.5, "x\ny"]), "[True, False, None, 1.5, 'x\\ny']")
  })
})

describe("smart quotes", () => {
  it("curl the delimiters and keep escaped quotes inside the text", () => {
    assert.equal(smartQuotes({ a: 'say "hi"', b: [1, null] }), '{“a”: “say \\"hi\\"”, “b”: [1, null]}')
  })
})
