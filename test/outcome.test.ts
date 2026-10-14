import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { differences, outcomeOf, READERS, verdictKeys } from "../src/outcome.ts"

const meant = { pass: false, reason: "wrong year", score: 0.75, areas: ["BSD", "Serpong"] }
const got = (value: unknown) => ({ ok: true as const, value })

describe("outcomes", () => {
  it("call a repair exact only when every value is the meant one", () => {
    assert.equal(outcomeOf(meant, got(structuredClone(meant))).outcome, "exact")
    assert.equal(outcomeOf(meant, { ok: false, error: "Colon expected" }).outcome, "refused")
  })

  it("call fields or items left out dropped, when what is there is right", () => {
    assert.equal(outcomeOf(meant, got({ pass: false, reason: "wrong year" })).outcome, "dropped")
    assert.equal(outcomeOf(meant, got({ ...meant, areas: ["BSD"] })).outcome, "dropped")
  })

  it("name each way a value changes", () => {
    const how = (value: unknown) => differences(meant, value).map((d) => `${d.path} ${d.how}`)
    assert.deepEqual(how({ ...meant, reason: "wrong ye" }), ["$.reason text cut short"])
    assert.deepEqual(how({ ...meant, reason: "right year" }), ["$.reason text changed"])
    assert.deepEqual(how({ ...meant, score: 0.7 }), ["$.score number changed"])
    assert.deepEqual(how({ ...meant, pass: "f" }), ["$.pass true, false or null became text"])
    assert.deepEqual(how({ ...meant, pass: null }), ["$.pass became null"])
    assert.deepEqual(how({ ...meant, pass: 0 }), ["$.pass type changed"])
    assert.deepEqual(how({ ...meant, areas: ["BSD", "Serp"] }), ["$.areas[1] text cut short"])
    assert.deepEqual(how({ ...meant, extra: 1 }), ["$.extra extra"])
    assert.deepEqual(how([meant, meant]), ["$ an array, not the object"])
    assert.deepEqual(how(""), ["$ text, not the object"])
    assert.deepEqual(how(null), ["$ not the object"])
    assert.equal(outcomeOf(meant, got({ ...meant, pass: "f" })).outcome, "changed")
  })

  it("read a cut literal as text only when it could be the start of true, false or null", () => {
    assert.deepEqual(differences({ a: true }, { a: "tru" }).map((d) => d.how), ["true, false or null became text"])
    assert.deepEqual(differences({ a: null }, { a: "n" }).map((d) => d.how), ["true, false or null became text"])
    assert.deepEqual(differences({ a: true }, { a: "yes" }).map((d) => d.how), ["type changed"])
    assert.deepEqual(differences({ a: true }, { a: "" }).map((d) => d.how), ["type changed"])
  })
})

describe("readers", () => {
  it("find the verdict fields", () => {
    assert.deepEqual(verdictKeys({ reason: "x", pass: true, score: 1 }), ["pass"])
    assert.deepEqual(verdictKeys({ grounded: true, onVoice: false, natural: true }), ["grounded", "onVoice", "natural"])
    assert.deepEqual(verdictKeys([true]), [])
  })

  it("read a cut false the way code does: truthy says pass, strict says fail, zod refuses", () => {
    const cut = { pass: "f" }
    assert.equal(READERS.truthy(cut, "pass"), true)
    assert.equal(READERS.strict(cut, "pass"), false)
    assert.equal(READERS.zod(cut, "pass"), "rejected")
    assert.equal(READERS.zod({ pass: false }, "pass"), false)
    assert.equal(READERS.truthy([{ pass: true }], "pass"), false)
  })
})
