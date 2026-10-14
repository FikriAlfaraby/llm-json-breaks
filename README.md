# llm-json-breaks

**2,028 real LLM replies, broken the ways replies break, and what JSON repair libraries hand
back.**

When a model's JSON reply arrives broken, a repair library makes it parse again:
[jsonrepair](https://github.com/josdejong/jsonrepair) in JavaScript,
[json_repair](https://github.com/mangiucugna/json_repair) in Python. This repo asks whether the
repaired JSON still says what the model meant, or says something else without an error.

## What is in it

- **`data/replies.jsonl`**: 2,028 replies whose meaning is a JSON value.
  - 1,994 verdicts from LLM judges, exactly as the models sent them, recorded in
    [judge-mutants](https://github.com/FikriAlfaraby/judge-mutants) (GPT-6 Luna and Gemini 3.8
    Flash). 484 arrived inside a ```` ```json ```` fence.
  - 34 lead extractions and message drafts recorded in
    [wa-lead-extractor](https://github.com/FikriAlfaraby/wa-lead-extractor). Only the parsed
    values were kept there, so these are written out again with two-space indents: the values
    are the model's, the whitespace is mine.
- **`src/breaks.ts`**: twelve ways to break a reply, each with the value the model meant:

  | Break | What it does |
  |---|---|
  | as-sent | the reply exactly as recorded: the control, it must come back unchanged |
  | cut | the reply stopped after every character in turn, like a max_tokens stop |
  | fence | wrapped in a ```` ```json ```` fence |
  | prose | a sentence before the JSON and one after it |
  | trailing-comma | a comma after the last value |
  | comment | a `//` comment after the first value |
  | python | written as a Python dict: `True`, `False`, `None`, single quotes |
  | smart-quotes | curly quotes around every key and string |
  | raw-newline | a line break typed inside a string instead of `\n` |
  | inner-quotes | a word in a string quoted with unescaped double quotes |
  | missing-comma | the comma between the first two fields left out |
  | twice | the whole reply written twice |

- **`src/outcome.ts`**: each repair is **exact** (the meant value), **refused** (an error the
  caller sees), **dropped** (fields missing, everything present right) or **changed** (valid JSON
  that says something else: text cut short, a number changed, `false` turned into text, a field
  turned into `null`, an array instead of the object).
- **Readers.** A judge's verdict is read four ways: `if (result.pass)` (JavaScript or Python),
  `result.pass === true`, a zod schema with `z.boolean()`, and a pydantic model with `bool`.

Libraries, pinned: jsonrepair 3.15.0, json_repair 0.64.0 (default, and `strict=True`), zod
4.6.7, pydantic 2.14.1.

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

## Run it

```bash
npm install
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
node scripts/run.ts                 # every variant, through jsonrepair
.venv/bin/python src/run_py.py      # the same variants, through json_repair; pydantic readings
```

MIT licence. Fikri Alfaraby, [fikrialfaraby.com](https://fikrialfaraby.com).
