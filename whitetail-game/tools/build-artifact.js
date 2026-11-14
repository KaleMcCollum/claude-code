#!/usr/bin/env node
/* Builds a single self-contained HTML page (all scripts inlined) for sharing as one file.
   Usage: node tools/build-artifact.js [out.html] [--fragment] [--offline]
   --fragment drops <!DOCTYPE>/<html>/<head>/<body> for hosts that wrap the page themselves.
   --offline builds the two fonts into the file too (from fonts/), so it needs no internet at all: a file to keep on a phone. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'whitetail-country.html');
const fragment = process.argv.includes('--fragment'), offline = process.argv.includes('--offline');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
if (offline) {
  const face = (family, file) => `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(data:font/woff2;base64,${fs.readFileSync(path.join(root, 'fonts', file)).toString('base64')}) format('woff2'); }`;
  const before = html;
  html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, `<style>\n${face('Press Start 2P', 'press-start-2p.woff2')}\n${face('VT323', 'vt323.woff2')}\n</style>`);
  if (html === before || /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html)) throw new Error('could not swap the web fonts for the built-in ones');
}
if (fragment) html = html.replace(/<!DOCTYPE html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*/i, '').replace(/<\/head>\s*<body>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, Math.round(html.length / 1024) + ' KB');
