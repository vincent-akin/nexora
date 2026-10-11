// Builds a single self-contained HTML file from the template. The icons, the
// shared game core, the browser engine and the game stylesheet are all inlined
// from the same source files the Next.js app uses, so the prototype and the
// app cannot drift apart.
//
//   node scripts/build-prototype.mjs [outfile]
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? resolve(root, 'prototype/beat-lanes.html');

const toJs = (file) => {
  const ts = readFileSync(resolve(root, file), 'utf8')
    // Imports are resolved by concatenation order: icons, core, engine.
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  return stripTypeScriptTypes(ts, { mode: 'strip' }).replace(/^export /gm, '');
};

const code = ['lib/icons.ts', 'lib/beat-lanes/core.ts', 'lib/beat-lanes/engine.ts'].map(toJs).join('\n');
const css = readFileSync(resolve(root, 'styles/game.css'), 'utf8');
const html = readFileSync(resolve(root, 'prototype/beat-lanes.template.html'), 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__CODE__*/', () => code);
writeFileSync(out, html);
console.log('wrote', out, `(${(html.length / 1024).toFixed(1)} KB)`);
