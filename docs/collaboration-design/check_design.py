"""Validate design artifacts, not the implemented QuanDeck backend.
Requires Python 3 and jsonschema (Draft 2020-12 support).
Run from any working directory: python3 docs/collaboration-design/check_design.py
"""
from pathlib import Path
from urllib.parse import unquote
import hashlib
import json
import re
import subprocess
import sys
from jsonschema import Draft202012Validator, FormatChecker

root = Path(__file__).resolve().parent
schemas = {}
for path in sorted((root / "contracts").glob("*.schema.json")):
    schema = json.loads(path.read_text())
    Draft202012Validator.check_schema(schema)
    schemas[path.name] = schema
assert len(schemas) == 3
cases = json.loads((root / "examples/validation-cases.json").read_text())
for case in cases:
    content = json.loads((root / "examples" / case["file"]).read_text())
    errors = list(Draft202012Validator(schemas[case["schema"]], format_checker=FormatChecker()).iter_errors(content))
    assert (not errors) == case["valid"], (case["file"], [e.message for e in errors])
print(f"PASS: {len(schemas)} protocol schemas and {len(cases)} positive/negative cases")

context = json.loads((root / "examples/context-package.valid.json").read_text())
for source in context["sources"]:
    assert hashlib.sha256(source["content"].encode()).hexdigest() == source["content_sha256"]
budget = context["input_budget"]
assert budget["estimated_input_tokens"] + budget["reserved_output_tokens"] + budget["reserved_tool_tokens"] <= budget["model_context_limit"]
print("PASS: source content hashes and context budget arithmetic")

for path in (root / "examples").glob("*.generated.md"):
    header, body = path.read_text().split("\n\n", 1)
    assert header == "export_content_sha256: " + hashlib.sha256(body.encode()).hexdigest(), path
print("PASS: generated project, ledger and blackboard export hashes")

for path in root.rglob("*.md"):
    content = path.read_text()
    assert content.count(chr(96) * 3) % 2 == 0, f"unpaired fence: {path}"
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
        if "://" in target or target.startswith("#"):
            continue
        target = target.split("#")[0]
        if target:
            assert (path.parent / unquote(target)).exists(), (path.name, target)
acceptance = (root / "acceptance.md").read_text()
ids = re.findall(r"^### (A\d{2})\b", acceptance, flags=re.M)
assert ids == [f"A{i:02d}" for i in range(1, 21)], ids
assert "未执行" in acceptance
print("PASS: documentation links, fences and twenty future acceptance scenarios")
subprocess.run([sys.executable, str(root / "check_schema.py")], check=True)
print("Scope: design artifacts only; no runtime behavior, real agent quality or external action reliability claimed.")
