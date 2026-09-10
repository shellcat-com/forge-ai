#!/usr/bin/env python3
"""Package verified npm content into a deterministic, credential-free tar input.
Indexes/logs are excluded. npm ci addresses content by lockfile SRI.
"""
import argparse, hashlib, pathlib, re, tarfile

def package(cache, destination):
    content = cache / '_cacache/content-v2/sha512'
    files = sorted(p for p in content.rglob('*') if p.is_file())
    if not files or any(p.is_symlink() for p in content.rglob('*')):
        raise ValueError('Missing/linked cache content')
    for path in files:
        relative = path.relative_to(content).as_posix()
        if not re.fullmatch(r'[a-f0-9]{2}/[a-f0-9]{2}/[a-f0-9]{124}', relative):
            raise ValueError('Invalid cache content path')
        if hashlib.sha512(path.read_bytes()).hexdigest() != relative.replace('/', ''):
            raise ValueError('Corrupt cache content')
    with destination.open('xb') as output, tarfile.open(fileobj=output, mode='w|', format=tarfile.PAX_FORMAT) as archive:
        for path in files:
            item = tarfile.TarInfo(path.relative_to(cache).as_posix())
            item.size = path.stat().st_size; item.mode = 0o444; item.mtime = 0; item.uid = 0; item.gid = 0
            with path.open('rb') as data: archive.addfile(item, data)
    print(hashlib.sha256(destination.read_bytes()).hexdigest())

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=pathlib.Path); parser.add_argument('destination', type=pathlib.Path)
    args = parser.parse_args(); package(args.cache, args.destination)
