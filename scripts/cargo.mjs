import { spawn } from 'node:child_process';
import { rustEnvironment } from './toolchain.mjs';
const child = spawn('cargo', process.argv.slice(2), { stdio: 'inherit', env: rustEnvironment() });
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
