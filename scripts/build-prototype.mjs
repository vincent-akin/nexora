// Builds the single-file prototypes. The icons, shared game cores, browser
// engines and stylesheets are all inlined from the same source files the
// Next.js app uses, so the prototypes and the app cannot drift apart.
//
//   node scripts/build-prototype.mjs [outdir]      writes beat-lanes.html and card-clash.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? resolve(root, 'prototype'));
mkdirSync(outDir, { recursive: true });

const toJs = (file) => {
  const ts = readFileSync(resolve(root, file), 'utf8')
    // Imports are resolved by concatenation order, so they are dropped here.
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  return stripTypeScriptTypes(ts, { mode: 'strip' }).replace(/^export /gm, '');
};

const builds = [
  {
    name: 'beat-lanes.html',
    template: 'prototype/beat-lanes.template.html',
    css: ['styles/game.css'],
    code: ['lib/icons.ts', 'lib/beat-lanes/core.ts', 'lib/beat-lanes/engine.ts'],
  },
  {
    name: 'card-clash.html',
    template: 'prototype/card-clash.template.html',
    css: ['styles/vault.css'],
    code: ['lib/icons.ts', 'lib/beat-lanes/core.ts', 'lib/card-clash/core.ts', 'lib/card-clash/audio.ts', 'lib/card-clash/board.ts'],
  },
];

for (const b of builds) {
  const code = b.code.map(toJs).join('\n');
  const css = b.css.map((f) => readFileSync(resolve(root, f), 'utf8')).join('\n');
  const html = readFileSync(resolve(root, b.template), 'utf8')
    .replace('/*__CSS__*/', () => css)
    .replace('/*__CODE__*/', () => code);
  const out = resolve(outDir, b.name);
  writeFileSync(out, html);
  console.log('wrote', out, `(${(html.length / 1024).toFixed(1)} KB)`);
}
