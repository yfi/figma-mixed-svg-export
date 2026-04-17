#!/bin/sh
# Bundles svgo.browser.js and the @jsquash/avif WASM encoder directly
# into ui.html by replacing inline markers in ui.template.html. Run
# this any time the template, SVGO bundle, or AVIF encoder change.
set -e
cd "$(dirname "$0")"

if [ ! -f ui.template.html ]; then
  echo "ui.template.html not found"
  exit 1
fi

AVIF_JS=node_modules/@jsquash/avif/codec/enc/avif_enc.js
AVIF_WASM=node_modules/@jsquash/avif/codec/enc/avif_enc.wasm
if [ ! -f "$AVIF_JS" ] || [ ! -f "$AVIF_WASM" ]; then
  echo "AVIF encoder missing — run: npm install @jsquash/avif"
  exit 1
fi

node <<'NODE_SCRIPT'
const fs = require('fs');

const tpl = fs.readFileSync('ui.template.html', 'utf8');
const svgo = fs.readFileSync('svgo.browser.js', 'utf8');

// AVIF encoder: strip ESM, shim import.meta, expose as a global factory.
// The upstream file references import.meta.url (and even assigns to it in
// a dead CloudflareWorkers branch), which is a parse error in a classic
// <script>. Rewriting import.meta to a plain object makes it load and
// behave identically under <script>.
let avifJs = fs.readFileSync('node_modules/@jsquash/avif/codec/enc/avif_enc.js', 'utf8');
avifJs = avifJs
  .replace(
    'var Module = (() => {',
    'window.__avifModuleFactory = (() => { var __importMetaShim = { url: "" };'
  )
  .replace(/import\.meta/g, '__importMetaShim')
  .replace(/export default Module;\s*$/m, '');

const avifWasmB64 = fs
  .readFileSync('node_modules/@jsquash/avif/codec/enc/avif_enc.wasm')
  .toString('base64');
const avifInline = avifJs + ';window.__avifWasmB64 = "' + avifWasmB64 + '";';

// Use function replacers so that any `$`-like sequences in the payloads
// aren't interpreted as replacement back-references.
const out = tpl
  .replace('/* SVGO:INLINE */', () => svgo)
  .replace('/* AVIF:INLINE */', () => avifInline);

fs.writeFileSync('ui.html', out);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(
  `Wrote ui.html (${mb(out.length)}; SVGO ${mb(svgo.length)}, AVIF ${mb(avifInline.length)})`
);
NODE_SCRIPT
