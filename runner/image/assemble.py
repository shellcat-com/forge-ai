#!/usr/bin/python3
"""Offline, trusted image packaging. Never run this against generated source.
Requires an operator-prepared Linux rootfs (systemd, nft, Python3, musl-compatible
runtime), exact Node/Postgres and Task03's verified offline dependency cache.
Does not download packages, install a host service or enable live admission.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tarfile


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def canonical(value):
    if isinstance(value, dict):
        return '{' + ','.join(canonical(k) + ':' + canonical(value[k]) for k in sorted(value, key=lambda s: s.encode('utf-16be'))) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, float) or isinstance(value, int) and abs(value) > 9007199254740991:
        raise ValueError('Noncanonical input number')
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def verify_cache(archive, cache_root):
    expected = set(); total = 0
    with tarfile.open(archive, 'r:') as files:
        for member in files:
            path = Path(member.name)
            if not member.isfile() or not member.name.startswith('_cacache/content-v2/sha512/') or path.is_absolute() or '..' in path.parts or member.name in expected:
                raise ValueError('Unsafe cache archive entry')
            expected.add(member.name); total += member.size
            if len(expected) > 20000 or total > 1073741824:
                raise ValueError('Cache archive cap')
            actual = cache_root / path
            if actual.is_symlink() or not actual.is_file() or actual.stat().st_size != member.size:
                raise ValueError('Prepared cache mismatch')
            with files.extractfile(member) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != sha(actual):
                    raise ValueError('Prepared cache byte drift')
    present = {str(path.relative_to(cache_root)) for path in cache_root.rglob('*') if not path.is_dir()}
    if present != expected:
        raise ValueError('Unexpected/missing prepared cache files')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepared-root', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--toolchain-archives', type=Path, required=True)
    parser.add_argument('--rootfs-mib', type=int, required=True)
    args = parser.parse_args()
    if os.uname().sysname != 'Linux' or not 512 <= args.rootfs_mib <= 8192 or args.output.exists():
        raise ValueError('New output directory and Linux packager required')
    inputs = json.loads(args.inputs.read_text())
    root = args.prepared_root.resolve()
    # Operator-prepared inputs must provide actual bytes and hashes for every
    # host asset. No default/fake digest, tag, URL or package installation fallback.
    assets = json.loads(args.assets.read_text())
    if set(assets) != {'firecracker', 'jailer', 'guestKernel', 'dependencyCache', 'seccompFilter', 'supervisor'}:
        raise ValueError('Exact pre-rootfs host assets required')
    if assets['dependencyCache']['sha256'] != inputs['dependencyCacheArchiveSha256']:
        raise ValueError('Cache archive does not match Task03 inputs')
    for archive in inputs['archives']:
        path = args.toolchain_archives / archive['name']
        if path.name != archive['name'] or path.stat().st_size != archive['bytes'] or sha(path) != archive['sha256']:
            raise ValueError('Toolchain archive mismatch')
    for asset in assets.values():
        path = Path(asset['path'])
        if not path.is_file() or path.is_symlink() or sha(path) != asset['sha256']:
            raise ValueError('Pinned input mismatch')
    for relative in ('sbin/init', 'usr/bin/python3', 'usr/bin/systemd-run', 'usr/sbin/nft',
                     'opt/node/bin/node', 'opt/node/bin/npm', 'opt/postgres/bin/postgres', 'opt/postgres/bin/psql'):
        if not (root / relative).exists():
            raise ValueError('Incomplete prepared rootfs')
    if not (root / 'opt/forge/npm-cache').is_dir():
        raise ValueError('Missing reviewed offline cache')
    verify_cache(assets['dependencyCache']['path'], root / 'opt/forge/npm-cache')
    args.output.mkdir(mode=0o700, parents=True)
    repository = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='forge-image-') as temporary:
        stage = Path(temporary) / 'root'; shutil.copytree(root, stage, symlinks=True)
        for name in ('scratch', 'workspace', 'run/forge-config', 'opt/forge', 'etc/systemd/system/multi-user.target.wants'):
            (stage / name).mkdir(parents=True, exist_ok=True)
        copies = {'runner/guest/agent.py': 'opt/forge/agent.py', 'runner/guest/prepare.sh': 'opt/forge/guest-prepare',
                  'runner/guest/guest.nft': 'opt/forge/guest.nft',
                  'runner/guest/forge-guest.service': 'etc/systemd/system/forge-guest.service',
                  'runner/guest/forge-app.slice': 'etc/systemd/system/forge-app.slice',
                  'templates/next-postgres-v1/app-database.sql': 'opt/forge/app-database.sql'}
        for source, dest in copies.items():
            shutil.copyfile(repository / source, stage / dest); os.chmod(stage / dest, 0o555 if dest.endswith('guest-prepare') else 0o444)
        # Rootfs user IDs are part of the image contract, never allocated by apps.
        passwd = (stage / 'etc/passwd').read_text()
        if not any(line.startswith('postgres:x:1001:1001:') for line in passwd.splitlines()):
            raise ValueError('Prepared root needs postgres uid/gid1001 and app uid/gid1000')
        link = stage / 'etc/systemd/system/multi-user.target.wants/forge-guest.service'
        link.symlink_to('../forge-guest.service')
        output = args.output / 'rootfs.ext4'
        with output.open('xb') as f:
            f.truncate(args.rootfs_mib * 1048576)
        subprocess.run(['/usr/sbin/mkfs.ext4', '-q', '-F', '-m', '0', '-d', str(stage), str(output)], check=True,
                       env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}, timeout=120)
    # Packaging receipts are measurements only. The typed runtime bundle is
    # constructed after installing immutable paths; final E2 catalog digest follows.
    receipt = {'schemaVersion': 1, 'status': 'packaged-unvalidated', 'executionEnabled': False,
               'imageInputsDigest': hashlib.sha256(canonical(inputs).encode()).hexdigest(),
               'imageInputsFileSha256': hashlib.sha256(args.inputs.read_bytes()).hexdigest(),
               'hostAssets': assets,
               'templateInputsDigest': inputs['templateInputsDigest'],
               'guestAgentDigest': sha(repository / 'runner/guest/agent.py'), 'rootfsSha256': sha(output),
               'ownedFiles': {source: sha(repository / source) for source in copies},
               'missing': ['Linux boot and offline template proof', 'real containment campaign', 'release approval']}
    (args.output / 'packaging.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
