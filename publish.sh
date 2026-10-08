#!/usr/bin/env bash
# TypeMeter one-shot publisher — requires a valid GitHub PAT in scripts/.pat_eddy
# 1) creates the repo (if missing), 2) pushes, 3) creates a release with the VSIX,
# 4) files the TSPerf challenge submission issue on tsperf/tracer.
set -euo pipefail

PAT="$(cat /home/z/my-project/scripts/.pat_eddy | tr -d '[:space:]')"
GH="api.github.com"
REPO="eddyflores100-lang/typemeter"
DIR="$(cd "$(dirname "$0")" && pwd)"
VSIX="$(ls "$DIR"/typemeter-0.1.0.vsix)"
SUBMISSION_BODY="$(python3 - <<'PY'
import base64
body = open('/home/z/my-project/scripts/typemeter/SUBMISSION.md').read()
# strip the header line (issue title carries it)
body = body.split('\n', 1)[1]
print(base64.b64encode(body.encode()).decode())
PY
)"

echo "== 1. crear repo (si no existe) =="
code=$(curl -s -o /tmp/gh_repo.json -w "%{http_code}" -X POST "https://$GH/user/repos" \
  -H "Authorization: token $PAT" -H "Accept: application/vnd.github+json" \
  -d '{"name":"typemeter","description":"Compiler-level TypeScript type cost: load-time, complexity and attribution — VS Code plugin","homepage":"","private":false,"has_issues":true,"has_wiki":false}')
echo "  status: $code"; cat /tmp/gh_repo.json | head -c 300; echo

echo "== 2. push =="
cd "$DIR"
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${PAT}@github.com/${REPO}.git"
git branch -M main
git push -u origin main 2>&1 | tail -3

echo "== 3. release con VSIX =="
rel=$(curl -s -X POST "https://$GH/repos/${REPO}/releases" \
  -H "Authorization: token $PAT" -H "Accept: application/vnd.github+json" \
  -d '{"tag_name":"v0.1.0","name":"TypeMeter v0.1.0","body":"Compiler-level TS type load-time, complexity and cost attribution. See README. Install: code --install-extension typemeter-0.1.0.vsix"}')
upload_url=$(echo "$rel" | python3 -c "import json,sys; print(json.load(sys.stdin)['upload_url'].split('{')[0])")
echo "  upload_url: $upload_url"
curl -s -X POST "${upload_url}?name=typemeter-0.1.0.vsix" \
  -H "Authorization: token $PAT" -H "Content-Type: application/octet-stream" \
  --data-binary @"$VSIX" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  asset:', d.get('browser_download_url', d))"

echo "== 4. submission issue en tsperf/tracer =="
PAT="$PAT" python3 <<'PY'
import json, os, urllib.request
pat = os.environ['PAT']
body = open('/home/z/my-project/scripts/typemeter/SUBMISSION.md').read().split('\n', 1)[1]
data = json.dumps({"title": "TSPerf challenge submission: TypeMeter — compiler-level type load-time, complexity AND cost attribution", "body": body}).encode()
req = urllib.request.Request("https://api.github.com/repos/tsperf/tracer/issues",
    data=data, method="POST",
    headers={"Authorization": f"token {pat}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    print("  issue:", json.load(r)["html_url"])
PY
echo "LISTO."
