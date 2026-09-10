import argparse
import hashlib
import json
import pathlib
import subprocess

parser = argparse.ArgumentParser(description='Read-only Git-byte audit; no acceptance authority.')
parser.add_argument('--repository', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--package-inventory', type=pathlib.Path, required=True)
parser.add_argument('--commit', required=True)
args = parser.parse_args()
ROOT = args.repository.resolve()
OUT = args.output.resolve()
COMMIT = args.commit
OUT.mkdir(parents=True, exist_ok=True)

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def digest(data):
    return hashlib.sha256(data).hexdigest()

def emit(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')

assert git('rev-parse', 'HEAD').decode().strip() == COMMIT
assert not git('status', '--porcelain')
rows = []

def check(manifest, path, expected, commit=COMMIT, kind='source-or-artifact'):
    try:
        actual = digest(git('show', f'{commit}:{path}'))
    except subprocess.CalledProcessError:
        actual = None
    rows.append(dict(manifest=manifest, path=path, boundCommit=commit, kind=kind,
                     expected=expected, actual=actual, matched=expected == actual))

specs = [
    ('runner/evidence/task-02/manifest.json', [('files', False), ('evidence', False)]),
    ('docs/reports/evidence/task-03/manifest.json', [('sha256', True), ('ownedSourceSha256', False)]),
    ('docs/reports/evidence/task-04/manifest.json', [('sourceSha256', False), ('evidenceSha256', True)]),
    ('docs/reports/evidence/task-05/manifest.json', [('hashes', False)]),
    ('docs/reports/demo-delivery/evidence-task-07/manifest.json', [('sourceSha256', False), ('evidenceSha256', False)]),
    ('docs/reports/evidence/task-09/manifest.json', [('artifacts', True)]),
    ('docs/reports/evidence/task-01/manifest.json', [('sha256', True)]),
]
for manifest, fields in specs:
    data = json.loads(git('show', f'{COMMIT}:{manifest}'))
    for field, relative in fields:
        for path, expected in data[field].items():
            p = str(pathlib.PurePosixPath(manifest).parent / path) if relative else path
            check(manifest, p, expected)
for task, field, relative in [('06', 'files', False), ('08', 'evidence', True)]:
    manifest = f'docs/reports/evidence/task-{task}/manifest.json'
    data = json.loads(git('show', f'{COMMIT}:{manifest}'))
    for item in data[field]:
        path = str(pathlib.PurePosixPath(manifest).parent / item['path']) if relative else item['path']
        check(manifest, path, item['sha256'])

historical_manifest = 'docs/reports/evidence/task-09/manifest.json'
data = json.loads(git('show', f'{COMMIT}:{historical_manifest}'))
historical_commit = data['auditedSourceCommit']
inventory = json.loads((ROOT / 'docs/reports/evidence/task-09/source-inventory.json').read_text())
inventory_digest = digest(json.dumps(inventory['files'], sort_keys=True, separators=(',', ':')).encode())
assert inventory_digest == inventory['sourceDigest'] == data['sourceDigest']
for item in inventory['files']:
    check(historical_manifest, item['path'], item['sha256'], historical_commit, 'historical-source')
for path, expected in data['candidateFileHashes'].items():
    check(historical_manifest, path, expected, historical_commit, 'historical-candidate')
emit('combined-evidence-integrity.json', {
    'schemaVersion': 1, 'auditedCommit': COMMIT,
    'gitTree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
    'method': 'sha256 of git show exact-commit:path bytes; historical Task09 source verified at its own bound commit',
    'manifestCount': 9, 'checks': len(rows), 'matched': sum(r['matched'] for r in rows),
    'mismatches': [r for r in rows if not r['matched']], 'records': rows,
    'collectorAuthenticated': False, 'liveAcceptance': False,
    'limitations': ['Digest matches establish retained byte integrity, not execution authenticity or live provenance.',
                   'Raw pre-normalization hashes are intentionally not compared with published normalized logs.']})

pack = json.loads(args.package_inventory.read_text())[0]
files = pack['files']
paths = [f['path'] for f in files]
old = json.loads(git('show', f'{COMMIT}:docs/reports/evidence/task-09/package-proposal.json'))
patterns = old['rootPackageFilesProposal']
def allowed(path):
    return path in ['package.json', 'README.md', 'LICENSE'] or any(
        path.startswith(p) if p.endswith('/') else pathlib.PurePosixPath(path).match(p)
        for p in patterns)
new_runtime = sorted(p for p in paths if p.startswith(('runner/', 'deploy/'))
                     and '/evidence/' not in p and not allowed(p))
emit('combined-package-inventory.json', {
    'schemaVersion': 1, 'auditedCommit': COMMIT, 'command': 'npm pack --dry-run --ignore-scripts --json',
    'entryCount': len(files), 'compressedBytes': pack['size'], 'unpackedBytes': pack['unpackedSize'],
    'rootPrivate': json.loads((ROOT / 'package.json').read_text())['private'],
    'rootLockIncluded': 'package-lock.json' in paths,
    'licenseIncluded': 'LICENSE' in paths,
    'historicalOrResearchEntries': [p for p in paths if p.startswith(('docs/evidence/', 'docs/reports/evidence/', 'research/', 'runner/evidence/'))],
    'nestedArchives': [p for p in paths if p.endswith(('.zip', '.tgz', '.tar.gz'))],
    'oldAllowlistStatus': 'stale-not-applied; evaluate runtime additions explicitly before any manifest change',
    'runtimeOrDeploymentPathsMissingFromOldAllowlist': new_runtime,
    'files': files,
    'published': False, 'distributionReady': False})

print(json.dumps({'checks': len(rows), 'mismatches': [r for r in rows if not r['matched']],
                  'packageEntries': len(files), 'oldAllowlistMissingRuntimePaths': new_runtime}, indent=2))
