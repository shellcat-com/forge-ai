#!/usr/bin/python3
"""Installed as /opt/forge/bin/forge-linux-helper (root:root 0500).
Fixed privileged operations only; never execute candidate code on the host.
No configuration, service or VM is installed/started by importing this module.
"""
import contextlib
import ctypes
import signal
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import time

ROOT = Path('/var/lib/forge/runtime')
JAILS = Path('/var/lib/forge/jailer')
CONFIG = Path('/etc/forge/runtime.json')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
DIGEST = re.compile(r'^[0-9a-f]{64}$')


def canonical(value):
    if isinstance(value, dict):
        return '{' + ','.join(canonical(k) + ':' + canonical(value[k]) for k in sorted(value, key=lambda s: s.encode('utf-16be'))) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, float) or isinstance(value, int) and abs(value) > 9007199254740991:
        raise ValueError('Noncanonical number')
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def millis(text):
    return int(datetime.datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp() * 1000)


def now():
    return int(time.time() * 1000)


def parent_death_signal():
    parent = os.getppid()
    if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0 or parent == 1 or os.getppid() != parent:
        os._exit(1)


def run(argv, timeout=3):
    # Only platform-owned argv call sites below. Never use shell=True.
    return subprocess.run(argv, env=ENV, cwd='/', stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          timeout=timeout, check=True, preexec_fn=parent_death_signal).stdout.decode().strip()


def safe_file(path, immutable=True):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or path.resolve() != path:
        raise ValueError('Unsafe asset path')
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & (0o222 if immutable else 0o077):
        raise ValueError('Unsafe asset permissions')
    for parent in path.parents:
        p = parent.lstat()
        if not stat.S_ISDIR(p.st_mode) or p.st_uid != 0 or p.st_mode & 0o022:
            raise ValueError('Unsafe parent')
    return path


def file_hash(path):
    with open(safe_file(path), 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def atomic(path, value):
    tmp = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(canonical(value)); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextlib.contextmanager
def locked():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if ROOT.resolve() != ROOT or ROOT.stat().st_uid != 0 or ROOT.stat().st_mode & 0o077:
        raise ValueError('Unsafe runtime directory')
    fd = os.open(ROOT / 'owner.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def binding(d):
    return digest({k: v for k, v in d.items() if k not in ('issuedAt', 'expiresAt', 'leaseEpoch')})


def validate(d, attempt):
    for key in ('operationId', 'environmentId', 'appDatabaseId', 'workspaceId', 'projectId', 'jobId'):
        if not UUID.fullmatch(d[key]):
            raise ValueError('Invalid identity')
    if attempt is not None and not UUID.fullmatch(attempt):
        raise ValueError('Invalid attempt')
    for k in ('sourceManifestDigest', 'templateDigest', 'commandPolicyDigest', 'executionReviewDigest'):
        if not DIGEST.fullmatch(d[k]):
            raise ValueError('Invalid digest')
    if d['network'] != {'internet': False, 'appDatabase': 'guest-loopback', 'maxConnections': 5}:
        raise ValueError('Networking forbidden')
    caps = {'cpu': 2, 'memoryMiB': 4096, 'processes': 512, 'diskMiB': 8192, 'activeMs': 1200000, 'verificationMs': 600000, 'logBytes': 10485760}
    for k, cap in caps.items():
        if type(d['resources'][k]) is not int or not 1 <= d['resources'][k] <= cap:
            raise ValueError('Resource cap')
    if type(d['leaseEpoch']) is not int or d['leaseEpoch'] < 1 or not 0 < millis(d['expiresAt']) - millis(d['issuedAt']) <= 60000:
        raise ValueError('Lease cap')


def preflight(d):
    if sys.platform != 'linux' or os.geteuid() != 0 or not stat.S_ISCHR(Path('/dev/kvm').stat().st_mode):
        raise ValueError('Dedicated root Linux/KVM required')
    if not {'cpu', 'memory', 'pids'} <= set(Path('/sys/fs/cgroup/cgroup.controllers').read_text().split()):
        raise ValueError('cgroup v2 required')
    if Path('/proc/sys/kernel/unprivileged_bpf_disabled').read_text().strip() not in ('1', '2'):
        raise ValueError('Unprivileged BPF enabled')
    cfg = json.loads(safe_file(CONFIG, immutable=False).read_text())
    image = cfg['image']
    if set(image) != {'schemaVersion', 'architecture', 'isolation', 'templateInputsDigest', 'imageInputsDigest', 'guestAgentDigest', 'assets'} or image['schemaVersion'] != 1:
        raise ValueError('Invalid image manifest')
    if set(image['assets']) != {'firecracker', 'jailer', 'guestKernel', 'guestRootfs', 'dependencyCache', 'seccompFilter', 'supervisor'}:
        raise ValueError('Invalid image assets')
    for key in ('templateInputsDigest', 'imageInputsDigest', 'guestAgentDigest'):
        if not DIGEST.fullmatch(image[key]):
            raise ValueError('Invalid image digest')
    for asset in image['assets'].values():
        if set(asset) != {'path', 'sha256'} or not DIGEST.fullmatch(asset['sha256']):
            raise ValueError('Invalid asset digest')
    if not cfg['acceptedTemplateDigests'] or any(not DIGEST.fullmatch(value) for value in cfg['acceptedTemplateDigests']):
        raise ValueError('No released template catalog')
    for key in ('guests', 'cpu', 'memoryMiB', 'diskMiB'):
        if type(cfg['capacity'][key]) is not int or cfg['capacity'][key] <= 0:
            raise ValueError('Invalid host capacity')
    if image['isolation'] != 'firecracker-jailer-vsock-v1' or image['architecture'] != 'x86_64' or os.uname().machine != 'x86_64':
        raise ValueError('Image architecture mismatch')
    if 'sha256:' + digest(image) != d['imageDigest'] or d['templateDigest'] not in cfg['acceptedTemplateDigests']:
        raise ValueError('Image binding mismatch')
    # No supplied default config/acceptance. Root-owned evidence bytes are required
    # for deployment review; this read alone is not containment acceptance.
    if cfg['admission'] != 'operator-reviewed-dedicated-host':
        raise ValueError('Live admission disabled')
    for name in ('hostReview', 'isolationEvidence'):
        if file_hash(cfg[name]['path']) != cfg[name]['sha256']:
            raise ValueError('Missing review evidence')
    for asset in image['assets'].values():
        if not asset['path'].startswith('/opt/forge/') or file_hash(asset['path']) != asset['sha256']:
            raise ValueError('Pinned asset drift')
    if Path(image['assets']['firecracker']['path']).name != 'firecracker':
        raise ValueError('Fixed jail path required')
    if file_hash(__file__) != image['assets']['supervisor']['sha256']:
        raise ValueError('Helper drift')
    return cfg


def unit(record):
    return 'forge-vm-' + record['attempt'] + '.service'


def watchdog_unit(record):
    return 'forge-lease-' + record['attempt'] + '.service'


def jail(record):
    return JAILS / 'firecracker' / record['attempt'] / 'root'


def inactive(name):
    # systemctl failures are not absence. A missing unit has LoadState=not-found.
    result = run(['/usr/bin/systemctl', 'show', name, '--property=LoadState,ActiveState,ControlGroup'])
    props = dict(line.split('=', 1) for line in result.splitlines())
    jobs = run(['/usr/bin/systemctl', 'list-jobs', '--no-legend', '--no-pager'])
    if any(name in line.split() for line in jobs.splitlines()):
        return False
    if props.get('LoadState') == 'not-found':
        return True
    if props.get('ActiveState') not in ('inactive', 'failed'):
        return False
    group = props.get('ControlGroup')
    if group:
        if not group.startswith('/system.slice/forge-') or '..' in group:
            return False
        events = Path('/sys/fs/cgroup' + group) / 'cgroup.events'
        if events.exists() and 'populated 1' in events.read_text():
            return False
    return True


def stop(record):
    # kill before stop so TimeoutStopSec cannot leave candidate work running.
    name = unit(record)
    run(['/usr/bin/systemctl', 'mask', '--runtime', name])
    run(['/usr/bin/systemctl', 'daemon-reload'])
    if not inactive(name):
        run(['/usr/bin/systemctl', 'kill', '--kill-whom=all', '--signal=KILL', name])
        run(['/usr/bin/systemctl', 'stop', name])
    if not inactive(name):
        raise ValueError('VM/launcher still present')


def start(record, cfg):
    d = record['descriptor']; a = cfg['image']['assets']; r = d['resources']; root = jail(record)
    root.mkdir(parents=True, mode=0o700)
    # Copy pinned bytes, never link shared writable backing files into a jail.
    for name, target in [('guestKernel', 'kernel'), ('guestRootfs', 'rootfs.ext4'), ('seccompFilter', 'seccomp')]:
        shutil.copyfile(a[name]['path'], root / target)
        os.chmod(root / target, 0o444)
    # UID is globally unique for the retained attempt, allocated under the lock.
    uid = record['uid']; os.chown(root, uid, uid)
    scratch = root / 'scratch.ext4'
    run(['/usr/bin/fallocate', '-l', str(r['diskMiB'] * 1048576), str(scratch)])
    run(['/usr/sbin/mkfs.ext4', '-q', '-F', '-m', '0', str(scratch)])
    os.chown(scratch, uid, uid); os.chmod(scratch, 0o600)
    metadata = ROOT / (record['attempt'] + '-metadata'); metadata.mkdir(mode=0o700)
    atomic(metadata / 'launch.json', {'descriptor': d, 'attemptId': record['attempt'], 'key': record['key']})
    boot = root / 'launch.ext4'
    run(['/usr/bin/truncate', '-s', '4M', str(boot)])
    run(['/usr/sbin/mkfs.ext4', '-q', '-F', '-m', '0', '-d', str(metadata), str(boot)])
    shutil.rmtree(metadata); os.chmod(boot, 0o400); os.chown(boot, uid, uid)
    configuration = {'boot-source': {'kernel_image_path': '/kernel', 'boot_args': 'console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda ro init=/sbin/init'},
        'drives': [{'drive_id': 'rootfs', 'path_on_host': '/rootfs.ext4', 'is_root_device': True, 'is_read_only': True},
                   {'drive_id': 'scratch', 'path_on_host': '/scratch.ext4', 'is_root_device': False, 'is_read_only': False},
                   {'drive_id': 'launch', 'path_on_host': '/launch.ext4', 'is_root_device': False, 'is_read_only': True}],
        'machine-config': {'vcpu_count': r['cpu'], 'mem_size_mib': r['memoryMiB'], 'smt': False},
        'vsock': {'guest_cid': 3, 'uds_path': '/rpc.sock'}, 'network-interfaces': []}
    atomic(root / 'firecracker.json', configuration); os.chmod(root / 'firecracker.json', 0o444)
    # No daemonize/new-pid-ns: systemd owns the launcher and VMM process tree.
    # cgroup-version=2 with no --cgroup preserves systemd's transient-unit limits.
    argv = ['/usr/bin/systemd-run', '--quiet', '--unit=' + unit(record), '--service-type=exec',
        '--property=KillMode=control-group', '--property=TimeoutStopSec=1s', '--property=Restart=no',
        '--property=RuntimeMaxSec=' + str(r['activeMs'] / 1000),
        '--property=CPUQuota=' + str(r['cpu'] * 100) + '%',
        '--property=MemoryMax=' + str((r['memoryMiB'] + 256) * 1048576), '--property=MemorySwapMax=0',
        '--property=TasksMax=128', '--property=LimitCORE=0', '--property=PrivateNetwork=yes',
        '--property=StandardOutput=null', '--property=StandardError=null',
        a['jailer']['path'], '--id', record['attempt'], '--exec-file', a['firecracker']['path'],
        '--uid', str(uid), '--gid', str(uid), '--cgroup-version', '2', '--chroot-base-dir', str(JAILS),
        '--', '--no-api', '--config-file', '/firecracker.json', '--seccomp-filter', '/seccomp']
    # Establish independent lease monitor BEFORE starting the VMM. It uses the same
    # durable lock; once released a late launch cannot bypass a persisted tombstone.
    run(['/usr/bin/systemd-run', '--quiet', '--unit=' + watchdog_unit(record), '--service-type=exec',
         '--property=Restart=on-failure', '--property=RestartSec=1s', '--property=StandardOutput=null',
         '--property=StandardError=null', '/opt/forge/bin/forge-linux-helper', '--watch', d['operationId']])
    run(argv)


def dispatch(request):
    action = request['action']; d = request['descriptor']; attempt = request['attemptId']
    validate(d, attempt)
    if action == 'preflight':
        preflight(d); return {'available': True, 'imageDigest': d['imageDigest']}
    with locked():
        path = ROOT / (d['operationId'] + '.json')
        record = json.loads(path.read_text()) if path.exists() else None
        if record and (record['binding'] != binding(d) or d['leaseEpoch'] < record['descriptor']['leaseEpoch'] or attempt is not None and record['attempt'] is not None and attempt != record['attempt']):
            raise ValueError('Operation fenced')
        if action == 'launch':
            if record:
                raise ValueError('Attempt already consumed')
            cfg = preflight(d)
            records = [json.loads(p.read_text()) for p in ROOT.glob('*.json')]
            if any(x['descriptor']['environmentId'] == d['environmentId'] or x['descriptor']['appDatabaseId'] == d['appDatabaseId'] for x in records):
                raise ValueError('Identity reused')
            live = [x for x in records if not x.get('cleaned')]
            # Host overhead is reserved separately: rootfs/kernel copies, 4MiB
            # launch disk, VMM 256MiB and watchdog/agent processes per slot.
            if len(live) >= cfg['capacity']['guests'] or any(sum(x['descriptor']['resources'][k] for x in live) + d['resources'][k] > cfg['capacity'][k] for k in ('cpu', 'memoryMiB', 'diskMiB')):
                raise ValueError('Host capacity retained')
            if millis(d['issuedAt']) > now() or millis(d['expiresAt']) <= now():
                raise ValueError('Expired launch')
            record = {'descriptor': d, 'binding': binding(d), 'attempt': attempt, 'key': secrets.token_hex(32),
                      'tombstone': False, 'cleaned': False, 'createdAt': now(), 'lastObservedAt': now(), 'uid': 10000 + len(records)}
            if record['uid'] > 60000 or attempt is None:
                raise ValueError('Identity capacity')
            atomic(path, record)  # Durable intent before any OS side effect.
            try:
                start(record, cfg)
                if millis(d['expiresAt']) <= now():
                    raise ValueError('Launch expired')
            except BaseException:
                record['tombstone'] = True; atomic(path, record)
                raise
            return {'started': True}
        if record is None:
            if action not in ('revoke', 'stop', 'wipe', 'observe'):
                raise ValueError('Unknown operation')
            # Stop/revoke-before-create permanently consumes the operation identity.
            record = {'descriptor': d, 'binding': binding(d), 'attempt': attempt, 'tombstone': True,
                      'cleaned': False, 'createdAt': now(), 'lastObservedAt': now(), 'key': None, 'uid': 0}
            atomic(path, record)
        if record['attempt'] is None and attempt is not None:
            record['attempt'] = attempt; atomic(path, record)
        if action in ('renew', 'binding'):
            old = record['descriptor']
            if record['tombstone'] or millis(old['expiresAt']) <= now() or now() < record['lastObservedAt'] or now() >= record['createdAt'] + d['resources']['activeMs']:
                raise ValueError('Lease fenced')
            if action == 'renew':
                if millis(d['expiresAt']) <= millis(old['expiresAt']) or millis(d['issuedAt']) > now():
                    raise ValueError('Stale renewal')
                record['descriptor'] = d; record['lastObservedAt'] = now(); atomic(path, record)
                return {'renewed': True}
            if d['leaseEpoch'] != old['leaseEpoch'] or d['expiresAt'] != old['expiresAt'] or inactive(unit(record)):
                raise ValueError('Unhealthy binding')
            return {'attemptId': record['attempt'], 'key': record['key'], 'socketPath': str(jail(record) / 'rpc.sock')}
        if action in ('revoke', 'stop', 'wipe'):
            record['tombstone'] = True; atomic(path, record)
        if action == 'revoke':
            # No NIC/listening TCP ports. Tombstone denies all broker/gateway bindings.
            return {'revoked': True}
        if action == 'stop':
            stop(record); return {'stopped': True}
        if action == 'wipe':
            if not inactive(unit(record)):
                raise ValueError('Cannot wipe running VM')
            root = jail(record).parent
            if root.exists():
                shutil.rmtree(root)  # Python fd-based rmtree refuses symlink traversal.
            metadata = ROOT / (record['attempt'] + '-metadata')
            if metadata.exists():
                shutil.rmtree(metadata)
            record['key'] = None; record['cleaned'] = True; atomic(path, record)
            return {'wiped': True}
        if action == 'observe':
            absent = inactive(unit(record)); volumes = not jail(record).parent.exists() and not (ROOT / (record['attempt'] + '-metadata')).exists()
            return {'operationId': d['operationId'], 'launchAttemptId': attempt,
                    'ingressAbsent': record['tombstone'], 'launcherAbsent': absent, 'vmAbsent': absent,
                    'volumesAbsent': volumes, 'appCredentialsAbsent': volumes and record['key'] is None, 'observedAt': now()}
        raise ValueError('Unknown fixed action')


def watch(operation):
    if not UUID.fullmatch(operation):
        raise ValueError('Invalid watcher identity')
    while True:
        with locked():
            path = ROOT / (operation + '.json'); record = json.loads(path.read_text()); d = record['descriptor']
            if record.get('cleaned'):
                return
            current = now()
            if record['tombstone'] or current < record['lastObservedAt'] or current >= millis(d['expiresAt']) or current >= record['createdAt'] + d['resources']['activeMs']:
                record['tombstone'] = True; atomic(path, record); stop(record)
                # A persistent mask and empty systemd job/cgroup observation now
                # prevent resurrection. Exit instead of reloading systemd every tick.
                # The supervisor still owns storage cleanup and capacity release.
                return
            record['lastObservedAt'] = max(current, record['lastObservedAt']); atomic(path, record)
        time.sleep(0.25)


if __name__ == '__main__':
    try:
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise ValueError('Dedicated Linux root helper required')
        if len(sys.argv) == 3 and sys.argv[1] == '--watch':
            watch(sys.argv[2])
        elif len(sys.argv) == 1:
            raw = sys.stdin.buffer.read(16385)
            if len(raw) > 16384:
                raise ValueError('Request cap')
            print(canonical(dispatch(json.loads(raw))))
        else:
            raise ValueError('Unknown entry point')
    except BaseException:
        # Never expose metadata, SQL, source, credentials or subprocess output.
        sys.stderr.write('Forge Linux operation failed; reconcile retained resources\n')
        sys.exit(1)
