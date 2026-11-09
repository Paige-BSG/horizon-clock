#!/usr/bin/env python3
"""Record process and compositor health; this does not prove visual clock correctness."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import time


def processes(binary):
    table = {}
    roots = set()
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            raw = (entry / 'stat').read_text()
            fields = raw[raw.rfind(')') + 2:].split()
            pid = int(entry.name)
            table[pid] = {
                'parent': int(fields[1]),
                'ticks': int(fields[11]) + int(fields[12]),
                'rss': int((entry / 'statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE'),
            }
            if (entry / 'exe').resolve() == binary:
                roots.add(pid)
        except (OSError, ValueError, IndexError):
            continue
    family = set(roots)
    while True:
        found = {pid for pid, row in table.items() if row['parent'] in family} - family
        if not found:
            break
        family.update(found)
    return roots, {pid: table[pid] for pid in family}


def compositor(roots):
    def query(name):
        result = subprocess.run(['hyprctl', '-j', name], check=True, capture_output=True,
                                text=True, timeout=8)
        return json.loads(result.stdout)
    try:
        clients = [c for c in query('clients') if c['pid'] in roots]
        monitors = query('monitors')
        return {
            'windows': len(clients),
            'fullscreen': any(c.get('fullscreen', 0) for c in clients),
            'inhibiting_idle': any(c.get('inhibitingIdle', False) for c in clients),
            'displays_on': all(m.get('dpmsStatus', False) for m in monitors) if monitors else False,
        }
    except (OSError, subprocess.SubprocessError, ValueError, KeyError):
        return {'compositor_unavailable': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--hours', type=float, default=72)
    parser.add_argument('--interval', type=float, default=60)
    args = parser.parse_args()
    if not 0 < args.hours <= 168 or args.interval < 1:
        parser.error('hours must be in (0, 168]; interval must be at least one second')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    binary = args.binary.resolve()
    started = time.monotonic()
    previous = {}
    previous_at = started
    samples = 0
    failures = 0
    # Exclusive creation protects evidence from an earlier run.
    with args.output.open('x', buffering=1) as log:
        while True:
            now = time.monotonic()
            roots, family = processes(binary)
            cpu_ticks = sum(max(0, p['ticks'] - previous[pid]['ticks'])
                            for pid, p in family.items() if pid in previous)
            row = {
                'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'elapsed_seconds': round(now - started, 1),
                'running': bool(roots),
                'processes': len(family),
                'rss_mib': round(sum(p['rss'] for p in family.values()) / 1048576, 1),
                'cpu_percent': round(cpu_ticks / os.sysconf('SC_CLK_TCK') /
                                     max(now - previous_at, .001) * 100, 2) if samples else None,
                **compositor(roots),
            }
            samples += 1
            if not row['running'] or not row.get('displays_on', False):
                failures += 1
            log.write(json.dumps(row) + '\n')
            previous, previous_at = family, now
            remaining = args.hours * 3600 - (time.monotonic() - started)
            if remaining <= 0:
                log.write(json.dumps({'complete': True, 'samples': samples,
                                      'unhealthy_samples': failures}) + '\n')
                break
            time.sleep(min(args.interval, remaining))


if __name__ == '__main__':
    main()
