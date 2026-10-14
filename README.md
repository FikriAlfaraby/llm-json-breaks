# llm-json-breaks

**2,028 real LLM replies, broken the ways replies break, and what JSON repair libraries hand
back.**

When a model's JSON reply arrives broken, a repair library makes it parse again:
[jsonrepair](https://github.com/josdejong/jsonrepair) in JavaScript,
[json_repair](https://github.com/mangiucugna/json_repair) in Python. A GitHub code search finds
them in apps like next-ai-draw-io, claude-task-master and dyad (jsonrepair) and VideoLingo
(json_repair). This repo asks whether the repaired JSON still says what the model meant, or
says something else without an error.

## Results

15 October 2026: 382,689 broken replies through jsonrepair 3.15.0 and json_repair 0.64.0 (its
default, and `strict=True`).

1. **A cut `false` reads as a pass.** A reply that stops inside `false` comes back as the text
   `"f"`, `"fa"`, `"fal"` or `"fals"`, in both libraries and in strict mode. Non-empty text is
   true to `if (result.pass)`, in JavaScript and in Python: 2,044 cut points, four in each of
   the 511 failing verdicts, read as passes. `result.pass === true`, zod and pydantic read none
   of them as a pass.
2. **jsonrepair turns a sentence around the JSON into an array.** "Here is my assessment:"
   before the reply, or the reply written twice: all 2,028 come back as an array, so
   `result.pass` is undefined and every pass reads as a fail. json_repair returns the object.
3. **json_repair cuts a curly-quoted string at its first comma.** With `“` and `”` around keys
   and strings, 1,814 replies had no curly quote in their own text. json_repair cut 446 of them
   at the first comma of a sentence and broke the fields of 10 more: `{“a”: “one, two”, “b”:
   true}` becomes `{"a": "one", "b": true}`. jsonrepair returned all 1,814 exactly. Still on
   json_repair's main branch (d34b372); I found no issue that reports it.
4. **Strict mode refuses a fenced reply.** `strict=True` refuses all 484 replies that Gemini
   sent inside a ```` ```json ```` fence, and every prose-wrapped or repeated one.
5. **The usual slips are fine.** A trailing comma, a `//` comment, a Python dict, a raw line
   break inside a string and a missing comma came back exact from all three, for every reply.

| Break | Replies | jsonrepair | json_repair | json_repair, strict |
|---|---:|---|---|---|
| as sent (control) | 2,028 | 2,028 exact | 2,028 exact | 484 refused (fenced) |
| fence | 1,544 | exact | exact | all refused |
| prose around it | 2,028 | all an array | exact | all refused |
| written twice | 2,028 | all an array | exact | all refused |
| curly quotes | 2,028 | 1,929 exact, 53 refused, 46 changed | 1,460 exact, 568 changed | 1,460 exact, 32 refused, 536 changed |
| unescaped inner quotes | 1,959 | 1,574 exact, 349 refused, 36 changed | 1,847 exact, 112 changed | 1,847 exact, 3 refused, 109 changed |
| trailing comma, comment, Python dict, raw line break, missing comma | 1,964 to 2,028 each | exact | exact | exact |

Every reply jsonrepair did not return exactly with curly quotes had curly quotes inside its own
text, where no parser can tell a quote mark from the end of the string. Unescaped inner quotes
are ambiguous the same way: jsonrepair mostly refuses; json_repair guesses, and in 45 replies the
verdict field disappeared into a made-up key, turning 17 passes into fails.

### Cut replies

Each reply stopped after every character in turn: 360,998 cut points.

| | jsonrepair | json_repair | json_repair, strict |
|---|---:|---:|---:|
| refused | 4,004 | 0 | 28,876 |
| valid JSON, the meant value | 6,433 | 7,349 | 5,897 |
| valid JSON, fields left out, the rest right | 19,060 | 47,118 | 45,680 |
| valid JSON, a value changed | 331,501 | 306,531 | 280,545 |
| a fail read as a pass by `if (result.pass)` | 2,044 | 2,044 | 2,044 |

Most changed values are text cut short, because most cuts land inside the reason. That is what
a cut does. What is missing is a signal: of 360,998 cut replies, jsonrepair refused 1% (most of
them still inside the opening fence), json_repair none, and strict mode 8%. A cut just before
the verdict value comes back as `null` from jsonrepair and as `""` from json_repair; both read as
a fail.

### What I got wrong

The predictions below were tagged before the run. Three were wrong in part:

- jsonrepair does refuse some cuts: 4,004, mostly inside the opening fence, the rest right after
  a comma, bracket or slash inside the text.
- Strict mode accepts a trailing comma, and refuses fenced replies, which I did not predict.
- jsonrepair refused 349 of 1,959 replies with unescaped inner quotes, not most, and returned
  1,574 exactly. And json_repair is not exact on curly quotes: it changed 568.

## What to do

1. **Check why the model stopped before you repair.** `finish_reason: "length"` (OpenAI-style
   APIs) or `stop_reason: "max_tokens"` (Anthropic) means the reply is cut: retry it or raise.
   Neither library will tell you.
2. **Read a verdict as a boolean.** `result.pass === true`, or a schema. Not `if (result.pass)`.
3. **Check the shape after jsonrepair.** A sentence around the JSON gives you an array, not an
   error. Take the JSON out yourself, or validate the result.
4. **With json_repair, watch curly quotes.** Until the comma bug is fixed, curly-quoted replies
   lose text silently; jsonrepair returned every plain-text one exactly.

## What is in it

- **`data/replies.jsonl`**: 2,028 replies whose meaning is a JSON value.
  - 1,994 verdicts from LLM judges, exactly as the models sent them, recorded in
    [judge-mutants](https://github.com/FikriAlfaraby/judge-mutants) (GPT-6 Luna and Gemini 3.8
    Flash). 484 arrived inside a ```` ```json ```` fence. 1,597 carry a true/false verdict.
  - 34 lead extractions and message drafts recorded in
    [wa-lead-extractor](https://github.com/FikriAlfaraby/wa-lead-extractor). Only the parsed
    values were kept there, so these are written out again with two-space indents: the values
    are the model's, the whitespace is mine.
- **`src/breaks.ts`**: twelve ways to break a reply, each with the value the model meant: the
  reply as sent (the control), cut after every character, fenced, prose around it, a trailing
  comma, a `//` comment, a Python dict, curly quotes, a raw line break in a string, an unescaped
  quoted word, a missing comma, the reply written twice.
- **`src/outcome.ts`**: each repair is **exact** (the meant value), **refused** (an error the
  caller sees), **dropped** (fields missing, everything present right) or **changed** (valid JSON
  that says something else). A verdict is read four ways: `if (result.pass)`, `=== true`, zod
  `z.boolean()`, pydantic `bool`.
- **`results/`**: counts per break, how each value changed, how each verdict was read, and three
  examples of every kind of change. A test runs jsonrepair again on all 382,689 variants and must
  get the published counts; CI does the same for json_repair.

## Predictions, written before the run

Written on 15 October 2026 and tagged `v0.1-prereg` before the results were read. What I knew:
both READMEs and issue trackers, jsonrepair's own tests, and 19 hand-written cases I ran through
both libraries. The runners were also smoke-tested once on the whole corpus before this tag; that
output was deleted unread.

1. **as-sent:** every reply comes back exact from both default libraries, fenced ones included.
2. **cut:** neither default library ever refuses a cut reply. A cut inside `true` or `false`
   comes back as the text `"t"`, `"fa"` and so on, in both libraries (jsonrepair quotes
   unquoted words by design). `if (result.pass)` reads a cut `false` as a pass; zod refuses it;
   pydantic reads `"f"` as false and refuses `"fa"`.
3. **cut, reason first:** in replies that give the reason before the verdict, most cuts land in
   the reason, the verdict goes missing, and `if (result.pass)` reads a fail. Those flips are
   the safe direction; the dangerous one (fail read as pass) is rarer.
4. **strict mode:** json_repair with `strict=True` refuses prose, a repeated reply and stray
   commas, as its README says. It does not refuse every cut.
5. **prose and twice:** jsonrepair returns an array instead of the object; json_repair returns
   the object.
6. **inner-quotes:** jsonrepair refuses most; json_repair repairs most exactly and changes some.
7. **fence, trailing-comma, comment, python, smart-quotes, raw-newline, missing-comma:** exact
   from both default libraries for nearly every reply.

## Limits

- Apart from the 484 fenced replies, every break is mine. This measures what a library does
  when a reply breaks a given way, not how often replies break.
- A max_tokens stop cuts between tokens, not characters; cutting at every character also counts
  positions no tokenizer would stop at.
- The judge replies are small flat objects. Only the 34 wa-lead replies are nested.
- One version of each library, one run (both are deterministic).

## Run it

```bash
npm install && npm run check                 # types, lint, tests (re-runs jsonrepair on everything)
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
node scripts/run.ts                          # every variant, through jsonrepair
.venv/bin/python src/run_py.py               # the same variants through json_repair; pydantic readings
node scripts/score.ts --check                # must match results/
```

MIT licence. Fikri Alfaraby, [fikrialfaraby.com](https://fikrialfaraby.com).
