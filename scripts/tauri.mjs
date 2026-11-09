import { spawn } from 'node:child_process';
import { rustEnvironment } from './toolchain.mjs';
const cli = new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url);
const child = spawn(process.execPath, [cli.pathname, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: rustEnvironment(),
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
