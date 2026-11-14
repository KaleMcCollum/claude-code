#!/usr/bin/env node
/* Builds a single self-contained HTML page (all scripts inlined) for sharing as one file.
   Usage: node tools/build-artifact.js [out.html] [--fragment] [--offline]
   --fragment drops <!DOCTYPE>/<html>/<head>/<body> for hosts that wrap the page themselves.
   The two fonts (fonts/) are always built into the file, so it needs no internet at all. --offline is accepted and no longer needed.
   The installed web app (manifest, service worker, icons) is served from the folder itself, not from this single file. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'whitetail-country.html');
const fragment = process.argv.includes('--fragment'), offline = process.argv.includes('--offline');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
// the two fonts go inside the file, and the parts that only make sense for the installed web app come out
html = html.replace(/<!--pwa-->[\s\S]*?<!--\/pwa-->\s*/g, '');
html = html.replace(/url\(fonts\/([a-z0-9-]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(root, 'fonts', f)).toString('base64')})`);
if (/url\(fonts\//.test(html) || /fonts\.googleapis\.com/.test(html)) throw new Error('a font was left pointing outside the file');
void offline; // every build is fully offline now; the flag is accepted for old commands
if (fragment) html = html.replace(/<!DOCTYPE html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*/i, '').replace(/<\/head>\s*<body>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, Math.round(html.length / 1024) + ' KB');
