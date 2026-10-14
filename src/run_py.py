"""Run json_repair on every broken reply, and read each library's verdicts with pydantic.

    .venv/bin/python src/run_py.py

Reads .cache/variants.jsonl and the JavaScript libraries' results (written by scripts/run.ts).
Writes, one line per variant:
  .cache/json_repair.jsonl             json_repair.loads(text)
  .cache/json_repair-strict.jsonl      json_repair.loads(text, strict=True)
  .cache/jiter-on.jsonl                jiter.from_json(text, partial_mode="on")
  .cache/jiter-trailing-strings.jsonl  jiter.from_json(text, partial_mode="trailing-strings")
  .cache/langchain-py.jsonl            langchain_core.utils.json.parse_partial_json(text)
  .cache/pydantic-<library>.jsonl      how a pydantic model with boolean fields reads each verdict
"""

from __future__ import annotations

import json
import sys
import time
from functools import lru_cache
from pathlib import Path

import jiter
import json_repair
from langchain_core.utils.json import parse_partial_json
from pydantic import Field, ValidationError, create_model

CACHE = Path(__file__).resolve().parent.parent / ".cache"
JS_LIBRARIES = ["jsonrepair", "ai-sdk", "partial-json", "langchain-js", "anthropic-sdk", "openai-sdk"]
PYTHON_LIBRARIES = {
    "json_repair": lambda text: json_repair.loads(text),
    "json_repair-strict": lambda text: json_repair.loads(text, strict=True),
    "jiter-on": lambda text: jiter.from_json(text.encode(), partial_mode="on"),
    "jiter-trailing-strings": lambda text: jiter.from_json(text.encode(), partial_mode="trailing-strings"),
    "langchain-py": parse_partial_json,
}


def repair(text: str, parse) -> dict:
    try:
        value = parse(text)
    except Exception as error:  # the library refused: the caller would see this
        return {"ok": False, "error": f"{type(error).__name__}: {error}"[:200]}
    if value is None:  # langchain-core's way of saying it could not read the text
        return {"ok": False, "error": "returned None"}
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as error:
        return {"ok": False, "error": f"returned a value that is not JSON: {error}"[:200]}
    return {"ok": True, "value": value}


@lru_cache(maxsize=None)
def model_for(keys: tuple[str, ...]):
    """A pydantic model whose fields are the verdict keys, each a required bool."""
    fields = {f"f{i}": (bool, Field(alias=key)) for i, key in enumerate(keys)}
    return create_model("Verdict", **fields)


def pydantic_reading(value: object, keys: list[str]) -> dict:
    """{key: True | False | "rejected"}: pydantic's lax mode turns "f" into False and "t" into True."""
    if not keys:
        return {}
    try:
        parsed = model_for(tuple(keys)).model_validate(value)
    except ValidationError:
        return {key: "rejected" for key in keys}
    return {key: getattr(parsed, f"f{i}") for i, key in enumerate(keys)}


def main() -> None:
    variants = [json.loads(line) for line in (CACHE / "variants.jsonl").read_text(encoding="utf-8").splitlines()]
    results: dict[str, list[dict]] = {}
    for name, parse in PYTHON_LIBRARIES.items():
        started = time.perf_counter()
        results[name] = [{"i": v["i"], **repair(v["text"], parse)} for v in variants]
        print(f"{name}: {len(variants)} variants in {time.perf_counter() - started:.1f} s", file=sys.stderr)
        (CACHE / f"{name}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results[name]), encoding="utf-8")
    for name in JS_LIBRARIES:
        results[name] = [json.loads(line) for line in (CACHE / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()]

    for name, rows in results.items():
        readings = []
        for v, r in zip(variants, rows):
            if r["i"] != v["i"]:
                raise SystemExit(f"{name}: row {r['i']} is out of step with variant {v['i']}")
            keys = v["verdictKeys"]
            readings.append({"i": v["i"], "read": pydantic_reading(r["value"], keys) if r["ok"] else {k: "rejected" for k in keys}})
        (CACHE / f"pydantic-{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in readings), encoding="utf-8")


if __name__ == "__main__":
    main()
