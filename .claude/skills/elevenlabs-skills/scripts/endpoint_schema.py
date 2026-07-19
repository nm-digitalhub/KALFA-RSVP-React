#!/usr/bin/env python3
"""Look up endpoint schemas in the ElevenLabs OpenAPI spec (multi-MB — never load it into context).

Usage:
  endpoint_schema.py <substring> [--full]
  Matches against path, operationId, and summary.

Examples:
  endpoint_schema.py text-to-speech        # list matching endpoints
  endpoint_schema.py /v1/convai/agents     # narrow by path
  endpoint_schema.py speech-to-text --full # include request/response schemas
Stdlib only. Caches spec 24h in $TMPDIR.
"""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path

# elevenlabs.io/openapi.json serves the docs-site HTML shell to non-browser clients;
# the API host serves the raw spec. Try in order, validate JSON before caching.
URLS = ["https://api.elevenlabs.io/openapi.json", "https://elevenlabs.io/openapi.json"]
CACHE = Path(os.environ.get("TMPDIR", "/tmp")) / "elevenlabs-openapi.json"

def fetch_one(url: str) -> bytes:
    try:  # curl handles proxies/UA filtering that break bare urllib
        return subprocess.run(["curl", "-fsSL", url], capture_output=True,
                              check=True, timeout=120).stdout
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (docs-skill)"})
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.read()

def load():
    # 24h cache: the spec changes at most a few times a week; a day-old copy is safe
    # for schema lookup while avoiding a 1.4MB download on every call.
    CACHE_TTL = 86400
    if CACHE.exists() and time.time() - CACHE.stat().st_mtime < CACHE_TTL:
        try:
            return json.loads(CACHE.read_text())
        except json.JSONDecodeError:
            CACHE.unlink()  # poisoned cache (e.g. HTML shell) — refetch
    last_err = None
    for url in URLS:
        try:
            data = fetch_one(url)
            spec = json.loads(data)  # validate BEFORE caching
            CACHE.write_bytes(data)
            return spec
        except Exception as e:
            last_err = e
    sys.exit(f"Could not fetch a valid OpenAPI spec from {URLS}: {last_err}")

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    q, full = sys.argv[1].lower(), "--full" in sys.argv
    spec = load()
    hits = []
    for path, ops in spec.get("paths", {}).items():
        for method, op in ops.items():
            if not isinstance(op, dict):
                continue
            hay = f"{path} {op.get('operationId','')} {op.get('summary','')}".lower()
            if q in hay:
                hits.append((path, method, op))
    if not hits:
        print(f"No endpoint matches '{q}'."); sys.exit(1)
    def deref(node, depth=0):
        """Resolve $ref one level into components/schemas so request-body
        field names are visible (specs hide them behind refs)."""
        if depth > 6 or not isinstance(node, (dict, list)):
            return node
        if isinstance(node, list):
            return [deref(x, depth + 1) for x in node]
        if "$ref" in node and node["$ref"].startswith("#/components/schemas/"):
            name = node["$ref"].rsplit("/", 1)[-1]
            target = spec.get("components", {}).get("schemas", {}).get(name, {})
            props = target.get("properties", {})
            summary = {k: v.get("type") or ("ref:" + v.get("$ref", "?").rsplit("/", 1)[-1] if "$ref" in v else "object")
                       for k, v in props.items()}
            return {"schema_name": name, "required": target.get("required", []), "properties": summary}
        return {k: deref(v, depth + 1) for k, v in node.items()}

    show_schema = full or len(hits) <= 3
    for path, method, op in hits:
        print(f"\n### {method.upper()} {path} — {op.get('summary','')}")
        if show_schema:
            body = {k: deref(op[k]) for k in ("parameters", "requestBody", "responses") if k in op}
            out = json.dumps(body, indent=1, default=str)
            print(out[:12000] + ("\n…[truncated — refine query]" if len(out) > 12000 else ""))
        else:
            print(f"  operationId: {op.get('operationId','—')}")
    if not show_schema:
        print(f"\n{len(hits)} matches — narrow the query or add --full for schemas.")

if __name__ == "__main__":
    main()
