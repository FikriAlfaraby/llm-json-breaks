// Builds data/replies.jsonl from two repos of recorded model replies:
//
//   node scripts/collect.ts ../judge-mutants ../wa-lead-extractor
//
// judge-mutants keeps every judge reply exactly as the model sent it (some inside a ```json fence).
// wa-lead-extractor kept only the parsed JSON, so those replies are written out again with two-space
// indents: the values are the model's, the whitespace is ours.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { unfence, type Reply } from "../src/replies.ts"

const MODELS: Record<string, string> = {
  luna: "gpt-6-luna",
  gemini: "gemini-3.8-flash",
  "cx/gpt-6-luna": "gpt-6-luna",
  "ag/gemini-3.8-flash": "gemini-3.8-flash",
}

type Found = Omit<Reply, "id">

function judgeReplies(repo: string): Found[] {
  const found: Found[] = []
  const runs = join(repo, "runs")
  for (const group of readdirSync(runs).filter((g) => g !== "cache").sort()) {
    let judges: string[]
    try {
      judges = readdirSync(join(runs, group)).sort()
    } catch {
      continue // a log file, not a folder of runs
    }
    for (const judge of judges) {
      if (!existsSync(join(runs, group, judge, "judged.jsonl"))) continue // a log next to the runs
      const model = MODELS[judge.split(".").at(-1) ?? ""]
      if (!model) throw new Error(`unknown model in ${group}/${judge}`)
      const lines = readFileSync(join(runs, group, judge, "judged.jsonl"), "utf8").split("\n").filter(Boolean)
      for (const line of lines) {
        const raw = (JSON.parse(line) as { raw?: string | null }).raw
        if (typeof raw !== "string") continue
        const value = parseJson(unfence(raw))
        if (value === undefined) continue // closed-QA judges answer in plain text, not JSON
        found.push({ source: `judge-mutants ${group}/${judge}`, model, kind: "judge", sent: "as sent", raw, value })
      }
    }
  }
  return found
}

interface Recorded {
  ok?: boolean
  extraction?: unknown
  output?: unknown
}

function leadReplies(repo: string): Found[] {
  const found: Found[] = []
  const add = (source: string, model: string, value: unknown) =>
    found.push({ source: `wa-lead-extractor ${source}`, model, kind: "extraction", sent: "re-serialized", raw: JSON.stringify(value, null, 2), value })
  const recordings = join(repo, "eval", "recordings")
  for (const file of readdirSync(recordings).sort()) {
    const recording = JSON.parse(readFileSync(join(recordings, file), "utf8")) as {
      eval?: Record<string, Record<string, Recorded>>
      scenarios?: Record<string, Record<string, { extraction?: Recorded | null; draft?: Recorded | null }>>
    }
    for (const [key, conversations] of Object.entries(recording.eval ?? {})) {
      for (const [id, run] of Object.entries(conversations)) {
        if (run.ok && run.extraction) add(`${file} eval/${key}/${id}`, MODELS[key] ?? key, run.extraction)
      }
    }
    for (const [scenario, byModel] of Object.entries(recording.scenarios ?? {})) {
      for (const [key, run] of Object.entries(byModel)) {
        if (!MODELS[key]) continue // a hand-made example, not a model reply
        if (run.extraction?.ok && run.extraction.extraction) add(`${file} ${scenario}/${key}/extraction`, MODELS[key], run.extraction.extraction)
        if (run.draft?.ok && run.draft.output) add(`${file} ${scenario}/${key}/draft`, MODELS[key], run.draft.output)
      }
    }
  }
  return found
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const [judgeRepo, leadRepo] = process.argv.slice(2)
if (!judgeRepo || !leadRepo) throw new Error("usage: node scripts/collect.ts <judge-mutants> <wa-lead-extractor>")

const seen = new Set<string>()
const replies: Reply[] = []
for (const reply of [...judgeReplies(judgeRepo), ...leadReplies(leadRepo)]) {
  if (seen.has(reply.raw)) continue // the same reply text recorded twice (repeats, a cached run)
  seen.add(reply.raw)
  const prefix = reply.kind === "judge" ? "j" : "x"
  const n = replies.filter((r) => r.kind === reply.kind).length + 1
  replies.push({ id: `${prefix}${String(n).padStart(4, "0")}`, ...reply })
}
writeFileSync(new URL("../data/replies.jsonl", import.meta.url), replies.map((r) => JSON.stringify(r)).join("\n") + "\n")
const fenced = replies.filter((r) => r.raw !== unfence(r.raw)).length
console.log(`data/replies.jsonl: ${replies.length} replies (${replies.filter((r) => r.kind === "judge").length} judge, ${fenced} of them fenced; ${replies.filter((r) => r.kind === "extraction").length} wa-lead)`)
