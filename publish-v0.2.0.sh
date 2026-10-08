#!/usr/bin/env bash
# TypeMeter v0.2.0 publisher — requires a VALID GitHub PAT (PAT actual en
# scripts/.pat_eddy, o variable GITHUB_TOKEN). Pasos:
#   1) verifica el token contra la API
#   2) push de los commits v0.2.0 a eddyflores100-lang/typemeter
#   3) release v0.2.0 con typemeter-0.2.0.vsix adjunto
#   4) comentario en el issue tsperf/tracer#118 con el texto del draft v02
set -euo pipefail

PAT="${GITHUB_TOKEN:-$(cat /home/z/my-project/scripts/.pat_eddy 2>/dev/null | tr -d '[:space:]')}"
GH="api.github.com"
REPO="eddyflores100-lang/typemeter"
DIR="$(cd "$(dirname "$0")" && pwd)"
VSIX="$DIR/typemeter-0.2.0.vsix"
COMMENT_BODY_FILE="/home/z/my-project/scripts/typemeter-issue118-v02-comment.md"
[ -f "$COMMENT_BODY_FILE" ] || COMMENT_BODY_FILE="/tmp/my-project/scripts/typemeter-issue118-v02-comment.md"

echo "== 0. verificar token =="
code=$(curl -s -o /tmp/gh_who.json -w "%{http_code}" -H "Authorization: token $PAT" "https://$GH/user")
if [ "$code" != "200" ]; then
  echo "TOKEN INVALIDO (HTTP $code) — genera un PAT nuevo y ponlo en scripts/.pat_eddy"
  cat /tmp/gh_who.json | head -c 200; echo; exit 1
fi
login=$(python3 -c "import json; print(json.load(open('/tmp/gh_who.json')).get('login'))")
echo "  token OK: $login"

echo "== 1. push v0.2.0 =="
cd "$DIR"
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${PAT}@github.com/${REPO}.git"
git branch -M main
git push -u origin main 2>&1 | tail -2

echo "== 2. release v0.2.0 con VSIX =="
rel=$(curl -s -X POST "https://$GH/repos/${REPO}/releases" \
  -H "Authorization: token $PAT" -H "Accept: application/vnd.github+json" \
  -d '{"tag_name":"v0.2.0","name":"TypeMeter v0.2.0","body":"Cross-check mode: self-validation against tsc --extendedDiagnostics --generateTrace (counter identity, cold-start totals, honest OOM survival) + version-accuracy fix (SyntaxKind shift). Real-project results: type-fest (tsc OOMs, sweep completes) and tsperf/tracer itself (59.6%/73.4% counter coverage). Install: code --install-extension typemeter-0.2.0.vsix"}')
upload_url=$(echo "$rel" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('upload_url','').split('{')[0]) or sys.exit(f'ERROR: {json.dumps(d)[:300]}')")
echo "  upload_url: $upload_url"
curl -s -X POST "${upload_url}?name=typemeter-0.2.0.vsix" \
  -H "Authorization: token $PAT" -H "Content-Type: application/octet-stream" \
  --data-binary "@$VSIX" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  asset:', d.get('name'), d.get('size'), 'bytes, state', d.get('state'))"

echo "== 3. comentario en tsperf/tracer#118 =="
B64="$(python3 -c "import base64; print(base64.b64encode(open('$COMMENT_BODY_FILE','rb').read()).decode())")"
code=$(curl -s -o /tmp/gh_comment.json -w "%{http_code}" -X POST \
  "https://$GH/repos/tsperf/tracer/issues/118/comments" \
  -H "Authorization: token $PAT" -H "Accept: application/vnd.github+json" \
  -d "{\"body\": \"$(python3 -c "
import base64
body = base64.b64decode('$B64').decode()
import json
print(json.dumps(body)[1:-1])
")\"}")
echo "  comment status: $code"
[ "$code" = "201" ] && echo "  URL: $(python3 -c "import json; print(json.load(open('/tmp/gh_comment.json')).get('html_url'))")"
echo "LISTO — v0.2.0 publicado + comentario en #118"
