#!/bin/bash
cd "$GITHUB_WORKSPACE"
FIXED=0
if ! grep -q 'casa-sync-k3m9qf27ahmed2026' js/sync.js; then cp .guard/sync.js js/sync.js; FIXED=1; fi
if ! grep -q 'mt-casa-v26' sw.js; then cp .guard/sw.js sw.js; FIXED=1; fi
if ! grep -q 'js/csl-bridge.js' index.html; then cp .guard/index.html index.html; FIXED=1; fi
if [ "$FIXED" = "1" ]; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git add -A
  git commit -m "guard: استرجاع الملفات الحرجة 🤖"
  git pull --rebase origin main || true
  git push origin main
  echo "guard: اتصلحت الملفات"
else
  echo "guard: كل حاجة سليمة"
fi
