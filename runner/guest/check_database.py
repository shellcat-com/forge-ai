#!/usr/bin/env python3
"""Opt-in NATIVE PostgreSQL compatibility test. Temporary synthetic cluster only.
Not a Linux guest, KVM isolation test, or app-process restart acceptance.
No .env, existing DATABASE_URL, external database or credentials are read.
"""
import importlib.util
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile


def main():
    root = Path(tempfile.mkdtemp(prefix='forge-task02-pg-'))
    data = root / 'data'; running = False; stopped = True
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C'}
    def command(argv, sql=None, password=None, check=True):
        local_env = dict(env)
        if password:
            local_env['PGPASSWORD'] = password
        result = subprocess.run(argv, input=sql, text=True, env=local_env, cwd=root,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        if check and result.returncode:
            raise RuntimeError('Native PostgreSQL command failed (diagnostics suppressed)')
        return result
    with socket.socket() as port_socket:
        port_socket.bind(('127.0.0.1', 0)); port = str(port_socket.getsockname()[1])
    args = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-d', 'forge_app']
    app_password = secrets.token_hex(32); migrator_password = secrets.token_hex(32)
    try:
        print(command(['postgres', '--version']).stdout.strip())
        command(['initdb', '-D', str(data), '-U', 'postgres', '--auth-local=trust', '--auth-host=scram-sha-256', '--no-locale'])
        with (data / 'postgresql.conf').open('a') as f:
            f.write("\npassword_encryption='scram-sha-256'\nlog_statement='none'\nlog_min_error_statement='panic'\n")
        command(['pg_ctl', '-D', str(data), '-l', str(root / 'pg.log'), '-o', '-h 127.0.0.1 -k ' + str(root) + ' -p ' + port, '-w', 'start']); running = True
        admin = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', str(root), '-p', port, '-U', 'postgres']
        command(admin + ['-d', 'postgres'], 'CREATE DATABASE forge_app;')
        repository = Path(__file__).resolve().parents[2]
        command(admin + ['-d', 'forge_app'], (repository / 'templates/next-postgres-v1/app-database.sql').read_text())
        spec = importlib.util.spec_from_file_location('forge_agent', Path(__file__).with_name('agent.py'))
        agent = importlib.util.module_from_spec(spec); spec.loader.exec_module(agent)
        command(admin + ['-d', 'forge_app'], agent.credential_sql(app_password, migrator_password))
        migration = 'BEGIN; CREATE TABLE app.tasks (id integer PRIMARY KEY, title text NOT NULL); COMMIT;'
        command(args + ['-U', 'forge_migrator'], migration, migrator_password)
        command(args + ['-U', 'forge_app'], "INSERT INTO app.tasks VALUES (1,'synthetic fixture');", app_password)
        assert command(args + ['-U', 'forge_app'], 'CREATE TABLE app.forbidden (x integer);', app_password, check=False).returncode != 0
        assert command(args + ['-U', 'forge_migrator'], 'CREATE ROLE forbidden SUPERUSER;', migrator_password, check=False).returncode != 0
        assert command(args + ['-U', 'forge_app'], 'SELECT 1;', secrets.token_hex(32), check=False).returncode != 0
        command(args + ['-U', 'forge_migrator'], 'BEGIN; ALTER TABLE app.tasks ADD COLUMN priority integer DEFAULT 0; COMMIT;', migrator_password)
        command(['pg_ctl', '-D', str(data), '-l', str(root / 'pg.log'), '-m', 'fast', '-w', 'restart'])
        value = command(args + ['-U', 'forge_app', '-At'], 'SELECT title, priority FROM app.tasks WHERE id=1;', app_password).stdout.strip()
        assert value == 'synthetic fixture|0'
        print('PASS: native SCRAM provisioning, app CRUD grants, denied DDL/superuser/wrong password, additive prior-row migration, PostgreSQL restart persistence.')
        print('NOT RUN: Linux guest provisioning, application process restart, containment, provider or deployment.')
    finally:
        if running:
            stopped = command(['pg_ctl', '-D', str(data), '-m', 'immediate', '-w', 'stop'], check=False).returncode == 0
        if stopped:
            shutil.rmtree(root); print('PASS: temporary native cluster stopped and removed.')
        else:
            raise RuntimeError('Cleanup failed; native cluster retained at ' + str(root))


if __name__ == '__main__':
    main()
