#!/bin/bash
cd "$GITHUB_WORKSPACE"
FIXED=0
if ! grep -q 'firebase-app-compat' index.html; then cp .guard/index.html index.html; FIXED=1; fi
if ! grep -q "typeof SYNC" js/app.js; then cp .guard/app.js js/app.js; FIXED=1; fi
if ! grep -q 'js/vendor/firebase-app-compat.js' sw.js; then cp .guard/sw.js sw.js; FIXED=1; fi
if [ "$FIXED" = "1" ]; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git add -A
  git commit -m "guard: إعادة ربط Firebase تلقائيًا بعد رفع نسخة قديمة 🤖"
  git pull --rebase origin main || true
  git push origin main
  echo "guard: اتصلحت الملفات"
else
  echo "guard: كل حاجة سليمة"
fi
