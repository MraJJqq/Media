#!/usr/bin/env python3
"""Static integrity checks for the standalone VEGAS V6 Pages site."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []

def fail(message):
    errors.append(message)

def local_target(base, raw):
    raw = (raw or "").strip()
    if not raw or raw.startswith("#") or raw.startswith("data:"):
        return None
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    if path.startswith("/"):
        return (ROOT / path.lstrip("/")).resolve()
    return (base / path).resolve()

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.inline_scripts = []
        self._script = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "img", "iframe", "source", "link"):
            for key in ("src", "href"):
                if attrs.get(key):
                    self.refs.append((tag, attrs[key]))
        if tag == "script" and not attrs.get("src"):
            self._script = [attrs.get("type", ""), ""]
    def handle_data(self, data):
        if self._script is not None:
            self._script[1] += data
    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            kind, source = self._script
            if source.strip() and "json" not in kind.lower():
                self.inline_scripts.append(source)
            self._script = None

html_files = list(ROOT.rglob("*.html"))
for page in html_files:
    parser = PageParser()
    parser.feed(page.read_text(encoding="utf-8"))
    for tag, ref in parser.refs:
        target = local_target(page.parent, ref)
        if target is not None and not target.is_file():
            fail(f"{page.relative_to(ROOT)}: missing {tag} reference {ref}")
    for index, source in enumerate(parser.inline_scripts, 1):
        result = subprocess.run(
            ["node", "--input-type=module", "--check"],
            input=source, text=True, capture_output=True
        )
        if result.returncode:
            fail(f"{page.relative_to(ROOT)} inline script #{index}: {result.stderr.strip()}")

for css in ROOT.rglob("*.css"):
    source = css.read_text(encoding="utf-8")
    for raw in re.findall(r"url\(\s*['\"]?([^'\")]+)", source, re.I):
        target = local_target(css.parent, raw)
        if target is not None and not target.is_file():
            fail(f"{css.relative_to(ROOT)}: missing CSS resource {raw}")

import_re = re.compile(r"(?:\bfrom\s*|\bimport\s*)['\"]([^'\"]+)['\"]")
for js in ROOT.rglob("*.js"):
    source = js.read_text(encoding="utf-8")
    for ref in import_re.findall(source):
        if not ref.startswith("."):
            continue
        target = local_target(js.parent, ref)
        if target is not None and not target.is_file():
            fail(f"{js.relative_to(ROOT)}: missing module {ref}")

runtime_files = html_files + list(ROOT.rglob("*.js")) + [ROOT / ".github/workflows/pages.yml"]
runtime_text = "\\n".join(path.read_text(encoding="utf-8") for path in runtime_files)
for forbidden in ("MraJJqq/V5", "bitget", "yahoo"):
    if forbidden.lower() in runtime_text.lower():
        fail(f"unexpected runtime dependency reference: {forbidden}")

for old_name in ("universe-v4.js", "page-lifecycle-v4.js",
                 "v5-kline-view.js", "v5-vegas-ema.js", "v5-viewport-state.js"):
    if (ROOT / "modules/shared" / old_name).exists() or (ROOT / "kline" / old_name).exists():
        fail(f"legacy module file remains: {old_name}")

runtime = (ROOT / "modules/v6-runtime.js").read_text(encoding="utf-8")
if "universe-v6.js" not in runtime or "page-lifecycle-v6.js" not in runtime:
    fail("runtime is not wired exclusively to V6 shared modules")
if "createV6KlineView" not in runtime:
    fail("runtime is not wired to the V6 K-line view")

# Guard the global layout contract: Logo outer geometry must live only in the
# global full-screen system, never in a Logo-specific host stylesheet.
full_screen_path = ROOT / "assets/css/full-screen-dynamic.css"
full_screen_source = full_screen_path.read_text(encoding="utf-8")
if not re.search(r"#logo-frame\s*\{[^}]*position\s*:\s*fixed", full_screen_source):
    fail("Logo outer geometry is missing from the global full-screen system")
if (ROOT / "modules/logo/host.css").exists():
    fail("conflicting Logo-specific host layout stylesheet remains")
index_source = (ROOT / "index.html").read_text(encoding="utf-8")
if "modules/logo/host.css" in index_source:
    fail("index.html still loads the Logo-specific host stylesheet")

controller = (ROOT / "kline/gate-kline-controller.js").read_text(encoding="utf-8")
if not re.search(r"merged\s*=\s*await\s+repairGaps\(c,tf,merged\)", controller):
    fail("latest-data refresh does not repair candle gaps before marking cache verified")
if 'DB_NAME="vegas-v6-market-cache"' not in controller:
    fail("Gate IndexedDB namespace is not V6-isolated")

controller = (ROOT / "kline/gate-kline-controller.js").read_text(encoding="utf-8")
if 'DB_VERSION=2' not in controller or 'META_STORE="seriesMeta"' not in controller:
    fail("V6 incremental cache schema version 2 is missing")
if "MEMORY_MAX_PER_SERIES=12000" not in controller or "MEMORY_MAX_TOTAL=30000" not in controller:
    fail("V6 volatile cache bounds are missing")
if 'createIndex("series","series"' not in controller or 'rowsStore.put({id:key+"|"+c.t,series:key,...c})' not in controller:
    fail("V6 per-candle IndexedDB storage is missing")
if "navigator.storage?.estimate" not in controller or "cache-storage-pressure" not in controller:
    fail("V6 browser storage pressure monitoring is missing")
if "memoryCacheIncomplete" not in controller:
    fail("V6 fallback cache eviction can incorrectly mark partial history complete")
if "discardedLegacyArray" not in controller:
    fail("V6 legacy cache migration may retain a duplicate full candle array in metadata")


# All static CSS/JS entry resources use one cache-busting release token.
STATIC_ASSET_VERSION = "v6-static-20261110-1"
static_versions = set()
for page in html_files:
    source = page.read_text(encoding="utf-8")
    for match in re.finditer(r"""(?:href|src)=["']([^"']+\.(?:css|js))\?v=([^"']+)["']""", source):
        static_versions.add(match.group(2))
if static_versions != {STATIC_ASSET_VERSION}:
    fail(f"static CSS/JS cache versions are not unified: {sorted(static_versions)}")

if errors:
    print("V6 validation FAILED:")
    for error in errors:
        print(" -", error)
    sys.exit(1)
print(f"V6 validation passed: {len(html_files)} HTML files; local references, inline scripts, CSS, imports, namespaces and dependencies checked.")
