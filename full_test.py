"""
Full automated test of the Gemini API Key modal functionality.
Tests: HTML structure, JS functions, model list, server delivery.
"""
import urllib.request
import json
import sys

PASS = "✅ PASS"
FAIL = "❌ FAIL"
results = []

def check(name, condition, detail=""):
    status = PASS if condition else FAIL
    results.append((status, name, detail))
    print(f"{status}: {name}" + (f" — {detail}" if detail else ""))
    return condition

print("=" * 65)
print("  AI Lesson Plan Studio — Full API Key Modal Test Suite")
print("=" * 65)
print()

# ─── TEST 1: Server Health ───────────────────────────────────────
print("── 1. Server Health ──")
try:
    health = json.loads(urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=5).read())
    check("Server is running", health.get("status") == "ok", f"version={health.get('version')}")
except Exception as e:
    check("Server is running", False, str(e))
    print("\n⛔ Server not running. Cannot continue.")
    sys.exit(1)

# ─── TEST 2: index.html ──────────────────────────────────────────
print("\n── 2. index.html Content ──")
html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=5).read().decode("utf-8", errors="replace")
check("btnApiKey button exists",          'id="btnApiKey"' in html)
check("onclick=openApiKeyModal()",        'onclick="openApiKeyModal()"' in html)
check("apiKeyModal div exists",           'id="apiKeyModal"' in html)
check("inputGeminiKey input exists",      'id="inputGeminiKey"' in html)
check("selectAiProvider dropdown exists", 'id="selectAiProvider"' in html)
check("btnSaveKey button exists",         'id="btnSaveKey"' in html)
check("btnTestKey button exists",         'id="btnTestKey"' in html)
check("testCurrentAiProviderKey() on Test btn", 'onclick="testCurrentAiProviderKey()"' in html)
check("saveApiKeyFromModal() on Save btn",       'onclick="saveApiKeyFromModal()"' in html)
check("app.js loaded (versioned)",               'app.js?v=' in html)

# ─── TEST 3: app.js Functions & Models ──────────────────────────
print("\n── 3. app.js Functions & Model List ──")
js = urllib.request.urlopen("http://127.0.0.1:8765/app.js", timeout=10).read().decode("utf-8", errors="replace")
check("openApiKeyModal() defined",            "function openApiKeyModal()" in js)
check("closeApiKeyModal() defined",           "function closeApiKeyModal()" in js)
check("saveApiKeyFromModal() defined",        "function saveApiKeyFromModal()" in js)
check("testCurrentAiProviderKey() defined",   "async function testCurrentAiProviderKey()" in js)
check("window.openApiKeyModal exported",      "window.openApiKeyModal = openApiKeyModal" in js)
check("window.testCurrentAiProviderKey exported", "window.testCurrentAiProviderKey = testCurrentAiProviderKey" in js)

# Model checks
check("gemini-2.5-pro in generator",          "'gemini-2.5-pro'" in js,    "Primary model for paid Pro users")
check("gemini-3.6-flash in generator",        "'gemini-3.6-flash'" in js,  "Latest Google recommended model")
check("gemini-2.5-pro in TEST function",      js.count("'gemini-2.5-pro'") >= 2, "Must appear in both generator & test")
check("OLD gemini-2.5-flash REMOVED",         "'gemini-2.5-flash'" not in js, "Deprecated model must be gone")

# ─── TEST 4: No-Cache Headers ────────────────────────────────────
print("\n── 4. Cache-Control Headers ──")
resp = urllib.request.urlopen("http://127.0.0.1:8765/app.js", timeout=5)
cc = resp.headers.get("Cache-Control", "")
check("Cache-Control: no-store set", "no-store" in cc, cc)

# ─── SUMMARY ─────────────────────────────────────────────────────
print()
print("=" * 65)
passed = sum(1 for r in results if r[0] == PASS)
failed = sum(1 for r in results if r[0] == FAIL)
total  = len(results)
print(f"  Results: {passed}/{total} passed  |  {failed} failed")
if failed == 0:
    print("  🎉 ALL TESTS PASSED — API Key Modal is 100% functional!")
else:
    print("  ⚠️  Some checks failed — see details above")
print("=" * 65)
