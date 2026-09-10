#!/usr/bin/env python3
"""Reproduce app compatibility on disposable synthetic PostgreSQL in a clean clone.

Run after npm ci and npm run verify. No generation worker or credentials are used.
"""
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
if (ROOT / '.env.local').exists() or (ROOT / '.env').exists():
    raise SystemExit('Use a clean reproduction clone without .env or .env.local.')
if not (ROOT / '.next/standalone/server.js').is_file():
    raise SystemExit('Run npm ci and npm run verify first.')
# No inherited provider, database, auth or deployment keys.
env = {name: os.environ[name] for name in ('PATH', 'HOME', 'TMPDIR') if name in os.environ}
env.update(CI='1', NEXT_TELEMETRY_DISABLED='1', FORGE_AUTH_MODE='local',
           FORGE_LOCAL_OWNER_ID='baseline-synthetic-owner', OLLAMA_BASE_URL='http://127.0.0.1:9')
root = Path(tempfile.mkdtemp(prefix='forge-baseline-pg-', dir='/tmp'))
started = False
server = None
server_log = None


def run(args, timeout=120):
    subprocess.run(args, cwd=ROOT, env=env, check=True, timeout=timeout)


try:
    run(['postgres', '--version'])
    run(['initdb', '-D', str(root / 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8', '-U', 'baseline_owner'])
    run(['pg_ctl', '-D', str(root / 'data'), '-l', str(root / 'postgres.log'), '-o',
         f"-k {root} -h '' -p 55441", '-w', 'start'])
    started = True
    env['DATABASE_URL'] = 'postgresql://baseline_owner@localhost/postgres?' + urllib.parse.urlencode({'host': str(root), 'port': '55441'})
    run(['npm', 'run', 'db:migrate'])
    run(['npm', 'run', 'db:migrate'])
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env['FORGE_TEST_URL'] = f'http://127.0.0.1:{port}'
    server_log = (root / 'app.log').open('w')
    server = subprocess.Popen(['npm', 'run', 'start', '--', '--port', str(port)], cwd=ROOT,
                              env=env, stdout=server_log, stderr=subprocess.STDOUT, start_new_session=True)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError('Reproduction application exited before readiness.')
        try:
            with urllib.request.urlopen(env['FORGE_TEST_URL'] + '/app', timeout=2) as response:
                if response.status == 200:
                    break
        except (OSError, urllib.error.URLError):
            time.sleep(0.2)
    else:
        raise RuntimeError('Reproduction application readiness timed out.')
    run(['npm', 'run', 'test:e2e'], timeout=300)
    print('PASS: application migrations (fresh + repeat), existing browser suite; synthetic local owner only.')
finally:
    if server is not None:
        try:
            os.killpg(server.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait(timeout=5)
    if server_log is not None:
        server_log.close()
    if started:
        run(['pg_ctl', '-D', str(root / 'data'), '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(root)
    print('Cleanup: owned application process stopped and disposable PostgreSQL directory removed.')
