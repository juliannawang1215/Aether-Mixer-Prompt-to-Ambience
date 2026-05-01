import { spawn, spawnSync } from 'node:child_process';

const PORT = 5173;

function pidsUsingPort(port) {
  const out = spawnSync('lsof', ['-ti', `tcp:${port}`], {
    encoding: 'utf8',
  });
  if (out.status !== 0 || !out.stdout) return [];
  return out.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Freed port ${PORT}: stopped PID ${pid}`);
    } catch {
      // Ignore stale/unprivileged PIDs.
    }
  }
}

const pids = pidsUsingPort(PORT);
if (pids.length > 0) killPids(pids);

const child = spawn(
  'npx',
  ['vite', '--host', '--port', String(PORT)],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

