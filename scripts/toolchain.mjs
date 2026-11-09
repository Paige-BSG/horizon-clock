import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function rustEnvironment() {
  const env = { ...process.env };
  const cargo = spawnSync('rustup', ['which', 'cargo'], { encoding: 'utf8' });
  if (cargo.status === 0) env.PATH = path.dirname(cargo.stdout.trim()) + path.delimiter + env.PATH;
  return env;
}
