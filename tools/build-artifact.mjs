// Builds dist/play.html: index.html without the document wrapper, for hosts
// (like claude.ai artifacts) that supply their own <html>/<head>/<body>.
// The page's other files (styles.css, src/, vendor/) are published beside it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = await readFile(join(root, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .split('\n')
  .filter((l) => !/<meta (charset|name="viewport")/.test(l))
  .join('\n');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'play.html'), `${head.trim()}\n${body.trim()}\n`);
console.log('wrote dist/play.html');
