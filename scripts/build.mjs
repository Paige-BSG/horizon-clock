import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'lib', 'assets']) {
  await cp(path.join(root, file), path.join(out, file), { recursive: true });
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(out, 'version.json'), JSON.stringify({ version: pkg.version }) + '\n');
console.log(`Built HORIZON ${pkg.version} → dist/ (local assets included)`);
