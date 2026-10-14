import { readFileSync } from "node:fs"

/** One recorded model reply whose meaning is a JSON value. */
export interface Reply {
  id: string
  /** Where it was recorded. */
  source: string
  model: string
  /** A judge's verdict (judge-mutants), or a lead extraction or message draft (wa-lead-extractor). */
  kind: "judge" | "extraction"
  /** "as sent": the exact text the model returned. "re-serialized": its parsed value written out again. */
  sent: "as sent" | "re-serialized"
  raw: string
  /** What the reply says: its JSON, parsed. Every break is scored against this. */
  value: unknown
}

const FENCE = /^\s*```(?:json)?[ \t]*\n([\s\S]*?)\n```\s*$/

/** The JSON inside a ```json fence, or the text itself when there is no fence. */
export function unfence(text: string): string {
  return FENCE.exec(text)?.[1] ?? text
}

export function loadReplies(path: URL | string = new URL("../data/replies.jsonl", import.meta.url)): Reply[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Reply)
}
