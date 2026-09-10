#!/usr/bin/env python3
"""Trusted acquisition only: verify lock-pinned tarballs without extracting/executing them.
Outputs are candidate evidence, never a D7 release authorization. Python stdlib plus curl.
"""
import argparse, base64, concurrent.futures, hashlib, io, json, pathlib, re, tarfile, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
def sha(data):
    return hashlib.sha256(data).hexdigest()
def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def download(url):
    if not re.fullmatch(r'https://registry\.npmjs\.org/[^?#]+', url):
        raise ValueError('Non-registry URL')
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--proto', '=https',
                             '--max-time', '45', '--retry', '2', '--max-filesize', str(128 * 1024 * 1024), url],
                            capture_output=True, check=True)
    if len(result.stdout) > 128 * 1024 * 1024:
        raise ValueError('Download cap')
    return result.stdout

def inspect_archive(data, name, version):
    licenses, hooks = {}, {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        if len(members) > 50000 or sum(m.size for m in members) > 512 * 1024 * 1024:
            raise ValueError('Archive cap')
        paths = [pathlib.PurePosixPath(m.name) for m in members]
        if any(p.is_absolute() or '..' in p.parts for p in paths) or len({p.parts[0] for p in paths}) != 1:
            raise ValueError('Archive path layout invalid')
        manifests = [m for m in members if len(pathlib.PurePosixPath(m.name).parts) == 2 and pathlib.PurePosixPath(m.name).name == 'package.json']
        if len(manifests) != 1 or not manifests[0].isfile() or manifests[0].size > 1024 * 1024:
            raise ValueError(f'Package metadata invalid: {name}@{version}; first entries: {[m.name for m in members[:3]]}')
        pkg = json.load(archive.extractfile(manifests[0]))
        if (pkg.get('name'), pkg.get('version')) != (name, version):
            raise ValueError(f'Package identity mismatch: {name}')
        for m in members:
            if m.isfile() and re.search(r'(^|/)(licenses?|licences?|copying|notice)([._-]|$)', m.name, re.I):
                licenses[m.name] = sha(archive.extractfile(m).read())
        for key in ['preinstall', 'install', 'postinstall', 'prepare']:
            if key in pkg.get('scripts', {}):
                hooks[key] = pkg['scripts'][key]
        if any(len(pathlib.PurePosixPath(m.name).parts) == 2 and pathlib.PurePosixPath(m.name).name == 'binding.gyp' for m in members) and 'install' not in hooks:
            hooks['implicitInstall'] = 'node-gyp rebuild'
    return {'license': pkg.get('license'), 'licenseFiles': licenses, 'hooks': hooks,
            'engines': pkg.get('engines', {}), 'os': pkg.get('os', []), 'cpu': pkg.get('cpu', [])}

def acquire(destination):
    destination.mkdir(parents=True, exist_ok=True)
    lock_bytes = (ROOT / 'package-lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    pkg = json.loads((ROOT / 'package.json').read_bytes())
    if lock['lockfileVersion'] != 3:
        raise ValueError('Lock v3 required')
    for section in ['dependencies', 'devDependencies']:
        if pkg.get(section, {}) != lock['packages'][''].get(section, {}):
            raise ValueError('Manifest/lock mismatch')
        for name, version in pkg.get(section, {}).items():
            if not re.fullmatch(r'\d+\.\d+\.\d+', version) or lock['packages']['node_modules/' + name]['version'] != version:
                raise ValueError('Unpinned direct dependency')
    keys_bytes = download('https://registry.npmjs.org/-/npm/v1/keys')
    keys = {k['keyid']: k for k in json.loads(keys_bytes)['keys']}
    def package(item):
        path, entry = item
        name = path.rsplit('node_modules/', 1)[1]
        integrity = entry['integrity']
        if entry.get('link') or not re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', integrity):
            raise ValueError('Invalid lock integrity')
        filename = sha(integrity.encode()) + '.tgz'
        target = destination / filename
        data = target.read_bytes() if target.exists() else download(entry['resolved'])
        if 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() != integrity:
            raise ValueError(f'Tarball integrity mismatch: {path}')
        meta_url = 'https://registry.npmjs.org/' + name.replace('/', '%2f') + '/' + entry['version']
        meta_bytes = download(meta_url)
        metadata = json.loads(meta_bytes)
        if metadata['dist']['integrity'] != integrity or metadata['dist']['tarball'] != entry['resolved']:
            raise ValueError(f'Registry/lock disagreement: {path}')
        published = None
        publication_metadata_sha256 = None
        if any(keys.get(sig['keyid'], {}).get('expires') for sig in metadata['dist'].get('signatures', [])):
            packument_bytes = download('https://registry.npmjs.org/' + name.replace('/', '%2f'))
            published = json.loads(packument_bytes).get('time', {}).get(entry['version'])
            publication_metadata_sha256 = sha(packument_bytes)
            if not published: raise ValueError('Missing publication time for expiring signing key')
        inspected = inspect_archive(data, name, entry['version'])
        if inspected['license'] != entry.get('license'):
            raise ValueError(f'License metadata mismatch: {path}')
        target.write_bytes(data)
        return {'path': path, 'name': name, 'version': entry['version'], 'resolved': entry['resolved'],
                'integrity': integrity, 'file': filename, 'bytes': len(data), 'sha256': sha(data),
                'metadataSha256': sha(meta_bytes), 'publishedAt': published, 'publicationMetadataSha256': publication_metadata_sha256, 'signatures': metadata['dist'].get('signatures', []),
                'attestations': metadata['dist'].get('attestations'), 'deprecated': metadata.get('deprecated'), **inspected}
    entries = [(p, e) for p, e in lock['packages'].items() if p]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        packages = list(pool.map(package, entries))
    packages.sort(key=lambda p: p['path'])
    report = {'schemaVersion': 1, 'status': 'candidate', 'origin': 'registry-package-bytes',
              'lockfileSha256': sha(lock_bytes), 'packageJsonSha256': sha((ROOT / 'package.json').read_bytes()),
              'hooksExecuted': [], 'packages': packages}
    (destination / 'dependencies.json').write_bytes(encoded(report))
    (destination / 'registry-keys.json').write_bytes(keys_bytes)
    print(json.dumps({'packages': len(packages), 'bytes': sum(p['bytes'] for p in packages),
                      'dependenciesSha256': sha(encoded(report))}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=pathlib.Path)
    acquire(parser.parse_args().destination)
