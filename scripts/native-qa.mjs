// Connect only to an explicitly enabled native-qa build on this machine.
// The caller supplies a JavaScript function body; no browser or native API is mocked.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = 'http://127.0.0.1:4445';
const [mode, source, output] = process.argv.slice(2);
async function request(path, method = 'GET', body) {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value));
  return result.value;
}

if (!['exec', 'test', 'screenshot'].includes(mode) || !source) {
  throw new Error(
    'Usage: node scripts/native-qa.mjs exec body.js [result.json] | test test.mjs [result.json] | screenshot image.png'
  );
}
const { sessionId } = await request('/session', 'POST', { capabilities: { alwaysMatch: {} } });
try {
  await request(`/session/${sessionId}/timeouts`, 'POST', { script: 40000 });
  if (mode === 'screenshot') {
    const encoded = await request(`/session/${sessionId}/screenshot`);
    await writeFile(source, Buffer.from(encoded, 'base64'));
    console.log(`Saved ${source}`);
  } else {
    const body =
      mode === 'test'
        ? `return await (${(await import(pathToFileURL(resolve(source)))).default.toString()})();`
        : await readFile(source, 'utf8');
    const result = await request(`/session/${sessionId}/execute/async`, 'POST', {
      script: `const done = arguments[arguments.length - 1];
        (async () => { ${body}\n })().then(
          value => done({ ok: true, value }),
          error => done({ ok: false, error: String(error), stack: error.stack })
        );`,
      args: [],
    });
    const json = JSON.stringify(result, null, 2);
    if (output) await writeFile(output, `${json}\n`);
    console.log(json);
    if (!result.ok || result.value?.results?.some((check) => !check.pass)) process.exitCode = 1;
  }
} finally {
  await request(`/session/${sessionId}`, 'DELETE');
}
