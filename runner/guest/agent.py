#!/usr/bin/python3
"""Guest-only root service. It must be baked into the pinned read-only image.
App code runs as uid 1000; PostgreSQL as uid 1001. Neither can read RPC/migrator
credentials or invoke this service through local TCP/Unix sockets.
"""
import base64
import datetime
import math
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import struct
import subprocess
import time

MAX_FRAME = 1048576
ENV = {'PATH': '/opt/node/bin:/opt/postgres/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
       'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1', 'HOME': '/scratch/home', 'TMPDIR': '/scratch/tmp'}


def canonical(value):
    if isinstance(value, dict):
        return '{' + ','.join(canonical(k) + ':' + canonical(value[k]) for k in sorted(value, key=lambda s: s.encode('utf-16be'))) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, float) or isinstance(value, int) and abs(value) > 9007199254740991:
        raise ValueError('Noncanonical JSON')
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def safe_path(value):
    if not isinstance(value, str) or len(value) > 240 or not re.fullmatch(r'[A-Za-z0-9_./@()\[\]-]+', value) or any(p in ('', '.', '..') for p in value.split('/')):
        raise ValueError('Unsafe path')
    return value


def receive(sock, size):
    out = bytearray()
    while len(out) < size:
        chunk = sock.recv(size - len(out))
        if not chunk:
            raise ValueError('Truncated frame')
        out.extend(chunk)
    return bytes(out)


def platform(argv, data=None, uid=0, timeout=60, env=None):
    # Stdout/stderr discarded: neither SQL errors nor secrets enter diagnostics.
    return subprocess.run(argv, input=data, env=env or ENV, cwd='/', user=uid, group=uid,
                          extra_groups=[], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=timeout, check=True)


def credential_sql(app_password, migrator_password):
    if not all(isinstance(p, str) and re.fullmatch(r'[0-9a-f]{64}', p) for p in (app_password, migrator_password)) or app_password == migrator_password:
        raise ValueError('Independent random app-local credentials required')
    return "ALTER ROLE forge_migrator LOGIN PASSWORD '" + migrator_password + "';\nALTER ROLE forge_app LOGIN PASSWORD '" + app_password + "';"


class Agent:
    def __init__(self, launch, clock=time.time):
        self.clock = clock
        self.d = launch['descriptor']; self.attempt = launch['attemptId']; self.key = bytes.fromhex(launch['key'])
        self.seen = set(); self.manifest = None; self.uploaded = set(); self.sealed = False
        self.total = 0; self.app_password = secrets.token_hex(32); self.migrator_password = secrets.token_hex(32)
        self.db_ready = False; self.started = False; self.commands = 0; self.collected = None
        self.epoch = self.d['leaseEpoch']; self.partial = {}

    def sql(self, sql, role='postgres', database='forge_app', timeout=60):
        env = dict(ENV)
        args = ['/opt/postgres/bin/psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database, '-U', role]
        if role == 'postgres':
            args += ['-h', '/scratch/pgsocket']
        else:
            args += ['-h', '127.0.0.1']; env['PGPASSWORD'] = self.app_password if role == 'forge_app' else self.migrator_password
        platform(args, sql.encode(), uid=1001 if role == 'postgres' else 0, timeout=timeout, env=env)

    def database(self):
        if self.db_ready:
            raise ValueError('Database already provisioned')
        for name in ('pgdata', 'pgsocket'):
            p = Path('/scratch') / name; p.mkdir(mode=0o700); os.chown(p, 1001, 1001)
        platform(['/opt/postgres/bin/initdb', '-D', '/scratch/pgdata', '--auth-local=peer', '--auth-host=scram-sha-256', '--no-locale'], uid=1001)
        config = Path('/scratch/pgdata/postgresql.conf')
        with config.open('a') as f:
            f.write("\nlisten_addresses='127.0.0.1'\nunix_socket_directories='/scratch/pgsocket'\npassword_encryption='scram-sha-256'\nmax_connections=12\nshared_buffers='64MB'\nlog_statement='none'\nlog_min_error_statement='panic'\n")
        platform(['/opt/postgres/bin/pg_ctl', '-D', '/scratch/pgdata', '-l', '/scratch/pgdata/server.log', '-w', 'start'], uid=1001)
        self.sql('CREATE DATABASE forge_app;', database='postgres')
        self.sql(Path('/opt/forge/app-database.sql').read_text())
        # Passwords are random hex, sent via stdin only and retained in root memory.
        self.sql(credential_sql(self.app_password, self.migrator_password))
        self.sql('SELECT 1;', role='forge_migrator')
        self.db_ready = True
        return {'database': 'forge_app', 'role': 'forge_migrator', 'address': '127.0.0.1', 'appDatabaseId': self.d['appDatabaseId']}

    def command(self, check, timeout):
        commands = {
            'dependencies': ['/opt/node/bin/npm', 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev', '--cache=/opt/forge/npm-cache'],
            'lint': ['/opt/node/bin/node', 'node_modules/eslint/bin/eslint.js', 'app', 'components', 'lib', '--max-warnings=0'],
            'typecheck': ['/opt/node/bin/node', 'node_modules/typescript/bin/tsc', '--noEmit'],
            'unit': ['/opt/node/bin/node', 'node_modules/vitest/vitest.mjs', 'run'],
            'build': ['/opt/node/bin/node', 'node_modules/next/dist/bin/next', 'build', '--webpack'],
        }
        if not self.sealed or check not in commands or type(timeout) is not int or not 0 < timeout <= 240000:
            raise ValueError('Unapproved guest command')
        self.commands += 1
        if self.commands > 20:
            raise ValueError('Command cap')
        unit = 'forge-check-' + str(self.commands)
        argv = self.app_unit(unit, timeout) + commands[check]
        started = int(time.time() * 1000); timed_out = False; oom = False
        try:
            result = subprocess.run(argv, env=ENV, cwd='/', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout / 1000 + 1)
            code = 0 if result.returncode == 0 else 1
            observed = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--property=Result', '--value'], env=ENV, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3)
            if observed.returncode:
                raise ValueError('Missing command observation')
            outcome = observed.stdout.strip()
            oom = outcome == 'oom-kill'; timed_out = outcome == 'timeout'
            if outcome != 'success':
                code = 1
        except subprocess.TimeoutExpired:
            code = 124; timed_out = True
        finally:
            # Unit RuntimeMaxSec and this explicit kill bound forks/background children.
            subprocess.run(['/usr/bin/systemctl', 'kill', '--kill-whom=all', '--signal=KILL', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=ENV, timeout=3)
        # Any nonzero/ambiguous systemd outcome fails. No stdout success parsing.
        return {'exitCode': code, 'timedOut': timed_out, 'oom': oom,
                'startedAtMs': started, 'finishedAtMs': int(time.time() * 1000)}

    def app_unit(self, unit, timeout, wait=True):
        r = self.d['resources']
        # Aggregate app slice caps apply to checks and app, not just each process.
        properties = ['User=1000', 'Group=1000', 'WorkingDirectory=/scratch/build', 'NoNewPrivileges=yes',
                      'KillMode=control-group', 'TimeoutStopSec=1s', 'Restart=no', 'UMask=0077',
                      'Slice=forge-app.slice', 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
                      'CapabilityBoundingSet=', 'RestrictSUIDSGID=yes', 'ProtectSystem=strict',
                      'ReadWritePaths=/scratch/build /scratch/home /scratch/tmp', 'ProtectHome=yes',
                      'InaccessiblePaths=/run/forge-config /scratch/pgdata /scratch/pgsocket',
                      'StandardOutput=null', 'StandardError=null', 'MemorySwapMax=0',
                      'RuntimeMaxSec=' + str(timeout / 1000), 'TasksMax=' + str(r['processes'])]
        argv = ['/usr/bin/systemd-run', '--quiet', '--unit=' + unit, '--service-type=exec']
        if wait:
            argv += ['--wait']
        else:
            argv += ['--collect']
        argv += ['--property=' + p for p in properties]
        env = dict(ENV)
        if self.db_ready:
            env['DATABASE_URL'] = 'postgresql://forge_app:' + self.app_password + '@127.0.0.1:5432/forge_app'
        # Environment is set in the trusted systemd unit, never a candidate shell.
        # ProtectProc on the guest service and different UIDs exclude root secrets.
        argv += ['--setenv=' + k + '=' + v for k, v in env.items()]
        return argv

    def handle(self, action, data):
        if action == 'manifest':
            if self.manifest is not None or digest(data) != self.d['sourceManifestDigest'] or len(data['files']) > 200:
                raise ValueError('Manifest binding')
            if data['template']['digest'] != self.d['templateDigest'] or data['template']['imageDigest'] != self.d['imageDigest'] or data['commandPolicyDigest'] != self.d['commandPolicyDigest']:
                raise ValueError('Source image binding')
            paths = [safe_path(f['path']) for f in data['files']]
            if len(set(p.lower() for p in paths)) != len(paths):
                raise ValueError('Duplicate path')
            self.manifest = data
            return {'accepted': True}
        if action == 'file':
            if self.sealed or self.manifest is None:
                raise ValueError('Source sealed')
            path = safe_path(data['path']); file = next(f for f in self.manifest['files'] if f['path'] == path)
            if path in self.uploaded or file['mode'] != '0644' or type(data['offset']) is not int:
                raise ValueError('Repeated source')
            content = base64.b64decode(data['data'], validate=True)
            if len(content) > 49152 or data['offset'] != len(self.partial.get(path, b'')):
                raise ValueError('Source offset/cap')
            assembled = self.partial.get(path, b'') + content
            self.total += len(content)
            if self.total > 10485760 or len(assembled) > file['bytes']:
                raise ValueError('Source cap')
            if len(assembled) < file['bytes']:
                if not content:
                    raise ValueError('Empty source progress')
                self.partial[path] = assembled
                return {'written': False}
            if hashlib.sha256(assembled).hexdigest() != file['sha256']:
                raise ValueError('Source bytes mismatch')
            self.partial.pop(path, None)
            target = Path('/scratch/source') / path; target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            with os.fdopen(fd, 'wb') as f:
                f.write(assembled)
            self.uploaded.add(path)
            return {'written': True}
        if action == 'seal':
            if self.sealed or self.manifest is None or len(self.uploaded) != len(self.manifest['files']):
                raise ValueError('Incomplete source')
            platform(['/usr/bin/mount', '--bind', '/scratch/source', '/workspace'])
            platform(['/usr/bin/mount', '-o', 'remount,bind,ro,nosuid,nodev', '/workspace'])
            platform(['/usr/bin/cp', '-R', '/workspace/.', '/scratch/build/'])
            platform(['/usr/bin/chown', '-R', '1000:1000', '/scratch/build'])
            self.sealed = True
            return {'sealed': True}
        if action == 'database':
            return self.database()
        if action == 'migrate':
            if not self.db_ready or not self.sealed or not isinstance(data['statements'], list) or not 1 <= len(data['statements']) <= 200:
                raise ValueError('Migration boundary')
            statements = data['statements']
            # Host strict SQL AST parser owns approval; authenticated RPC carries
            # canonical statements only. Migrator remains nonsuperuser, no OS SQL.
            if any(not isinstance(s, str) for s in statements) or len('\n'.join(statements).encode()) > 262144:
                raise ValueError('Migration cap')
            self.sql("BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';\n" + '\n'.join(statements) + '\nCOMMIT;', role='forge_migrator')
            return {'applied': len(statements)}
        if action == 'check':
            return self.command(data['checkId'], data['timeoutMs'])
        if action == 'start' or action == 'restart':
            if not self.sealed or not self.db_ready:
                raise ValueError('App not ready')
            if self.started and action == 'start':
                return {'started': True}
            if self.started:
                platform(['/usr/bin/systemctl', 'stop', 'forge-app.service'])
                self.started = False
            platform(self.app_unit('forge-app', self.d['resources']['activeMs'], wait=False) + ['/opt/node/bin/node', 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3000'])
            self.started = True
            return {'started': True}
        if action == 'health':
            if not self.db_ready or not self.started:
                raise ValueError('App/database not ready')
            self.sql('SELECT 1;', role='forge_app', timeout=5)
            response = self.handle('http', {'method': 'GET', 'path': '/api/health', 'headers': {}, 'body': ''})
            if response['status'] != 200:
                raise ValueError('App health failed')
            return {'processReady': True, 'databaseReady': True}
        if action == 'http':
            if not self.started:
                raise ValueError('App stopped')
            method = data['method']; path = data['path']; headers = data['headers']
            if method not in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS') or not isinstance(path, str) or not path.startswith('/') or path.startswith('//') or len(path) > 4096 or any(ord(c) < 32 for c in path):
                raise ValueError('Invalid HTTP request')
            allowed = {'accept', 'content-type', 'if-none-match', 'if-modified-since', 'range', 'accept-language'}
            if len(headers) > 20 or any(k not in allowed or not isinstance(v, str) or len(v) > 8192 or '\r' in v or '\n' in v for k, v in headers.items()):
                raise ValueError('Forbidden headers')
            body = base64.b64decode(data['body'], validate=True)
            if len(body) > 262144:
                raise ValueError('HTTP request cap')
            connection = http.client.HTTPConnection('127.0.0.1', 3000, timeout=5)
            try:
                connection.request(method, path, body=body, headers={**headers, 'Host': 'localhost:3000'})
                response = connection.getresponse(); content = response.read(524289)
                if len(content) > 524288 or 300 <= response.status <= 399 and response.status != 304:
                    raise ValueError('Oversized response or redirect')
                safe = {'content-type', 'etag', 'last-modified', 'cache-control', 'content-range', 'accept-ranges'}
                return {'status': response.status, 'headers': {k.lower(): v for k, v in response.getheaders() if k.lower() in safe}, 'body': base64.b64encode(content).decode()}
            finally:
                connection.close()
        if action == 'outputs':
            if self.collected is not None:
                return self.collected
            # Quiesce generated processes before traversing guest output. Host never
            # mounts this filesystem. Symlinks/hardlinks/devices fail, not followed.
            platform(['/usr/bin/systemctl', 'stop', 'forge-app.slice'])
            records = []; total = 0
            for base, prefix in [(Path('/scratch/build/.next'), 'build'), (Path('/scratch/build/public'), 'public')]:
                if not base.exists():
                    continue
                for path in sorted(base.rglob('*')):
                    if prefix == 'build' and path.relative_to(base).parts[0] in ('cache', 'diagnostics', 'types'):
                        continue
                    s = path.lstat()
                    if stat.S_ISDIR(s.st_mode):
                        continue
                    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
                        raise ValueError('Unsafe output entry')
                    relative = prefix + '/' + str(path.relative_to(base)); safe_path(relative)
                    total += s.st_size
                    if len(records) >= 10000 or total > 1073741824:
                        raise ValueError('Output cap')
                    records.append({'path': relative, 'bytes': s.st_size, 'kind': 'file', 'mode': '0644'})
            self.collected = records
            return records
        if action == 'output-chunk':
            if self.collected is None or type(data['offset']) is not int or data['offset'] < 0:
                raise ValueError('Output not frozen')
            record = next(f for f in self.collected if f['path'] == data['path'])
            base = '/scratch/build/.next/' if data['path'].startswith('build/') else '/scratch/build/public/'
            path = Path(base + data['path'].split('/', 1)[1])
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as f:
                s = os.fstat(f.fileno())
                if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size != record['bytes']:
                    raise ValueError('Output changed')
                f.seek(data['offset']); return {'data': base64.b64encode(f.read(49152)).decode()}
        raise ValueError('Unknown fixed RPC action')

    def request(self, envelope):
        mac = envelope.pop('mac')
        if not isinstance(mac, str) or not hmac.compare_digest(mac, hmac.new(self.key, canonical(envelope).encode(), hashlib.sha256).hexdigest()):
            raise ValueError('Unauthenticated request')
        if envelope['operationId'] != self.d['operationId'] or envelope['attemptId'] != self.attempt or envelope['sourceManifestDigest'] != self.d['sourceManifestDigest'] or envelope['imageDigest'] != self.d['imageDigest'] or envelope['leaseEpoch'] < self.epoch:
            raise ValueError('Fenced request')
        expiry = datetime.datetime.fromisoformat(envelope['expiresAt'].replace('Z', '+00:00'))
        current = self.clock()
        if expiry.tzinfo is None or not math.isfinite(current) or not 0 < expiry.timestamp() - current <= 60:
            raise ValueError('Expired or unbounded RPC lease')
        request_id = envelope['requestId']
        if request_id in self.seen or len(self.seen) >= 50000:
            raise ValueError('Replay/cap')
        self.seen.add(request_id); self.epoch = envelope['leaseEpoch']
        try:
            output = self.handle(envelope['action'], envelope['input']); ok = True
        except Exception:
            output = None; ok = False
        response = {'requestId': request_id, 'requestDigest': digest(envelope), 'ok': ok, 'output': output}
        return {**response, 'mac': hmac.new(self.key, canonical(response).encode(), hashlib.sha256).hexdigest()}


def main():
    if os.geteuid() != 0 or not hasattr(socket, 'AF_VSOCK'):
        raise ValueError('Pinned Linux guest required')
    launch = json.loads(Path('/run/forge-config/launch.json').read_text())
    agent = Agent(launch)
    # Root controls the slice; generated processes cannot increase any limit.
    r = agent.d['resources']
    platform(['/usr/bin/systemctl', 'set-property', '--runtime', 'forge-app.slice',
              'TasksMax=' + str(r['processes']), 'MemoryMax=' + str(max(32, r['memoryMiB'] - 256)) + 'M',
              'MemorySwapMax=0', 'CPUQuota=' + str(r['cpu'] * 100) + '%'])
    listener = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM); listener.bind((socket.VMADDR_CID_ANY, 4100)); listener.listen(8)
    while True:
        sock, peer = listener.accept()
        with sock:
            sock.settimeout(240)
            try:
                if peer[0] != socket.VMADDR_CID_HOST:
                    raise ValueError('Host vsock only')
                length = struct.unpack('!I', receive(sock, 4))[0]
                if not 2 <= length <= MAX_FRAME:
                    raise ValueError('Frame cap')
                envelope = json.loads(receive(sock, length))
                response = canonical(agent.request(envelope)).encode()
                if len(response) > MAX_FRAME:
                    raise ValueError('Response cap')
                sock.sendall(struct.pack('!I', len(response)) + response)
            except Exception:
                pass  # No source/SQL/credentials in serial logs or failure payloads.


if __name__ == '__main__':
    main()
