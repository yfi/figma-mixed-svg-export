#!/bin/sh
# Bundles svgo.browser.js directly into ui.html by replacing the
# <!-- SVGO:INLINE --> marker. Run this any time ui.html or
# svgo.browser.js change.
set -e
cd "$(dirname "$0")"

if [ ! -f ui.template.html ]; then
  echo "ui.template.html not found"
  exit 1
fi

node -e "
  const fs = require('fs');
  const tpl = fs.readFileSync('ui.template.html', 'utf8');
  const svgo = fs.readFileSync('svgo.browser.js', 'utf8');
  const out = tpl.replace('/* SVGO:INLINE */', svgo);
  fs.writeFileSync('ui.html', out);
  console.log('Wrote ui.html (' + out.length + ' bytes)');
"
