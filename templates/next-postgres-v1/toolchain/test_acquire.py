"""Synthetic hostile archives only; no network or dependency hooks."""
import hashlib, importlib.util, io, json, tarfile, tempfile, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('acquire', Path(__file__).with_name('acquire.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

def archive(pkg, duplicate=False):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as tar:
        payload = json.dumps(pkg).encode()
        for _ in range(2 if duplicate else 1):
            entry = tarfile.TarInfo('package/package.json'); entry.size = len(payload)
            tar.addfile(entry, io.BytesIO(payload))
    return output.getvalue()

spec_cache = importlib.util.spec_from_file_location('package_cache', Path(__file__).with_name('package-cache.py'))
cache_module = importlib.util.module_from_spec(spec_cache); spec_cache.loader.exec_module(cache_module)

class InspectTests(unittest.TestCase):
    def test_cache_reproducibility_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); content = b'reviewed synthetic bytes'; digest = hashlib.sha512(content).hexdigest()
            target = root/'cache/_cacache/content-v2/sha512'/digest[:2]/digest[2:4]/digest[4:]
            target.parent.mkdir(parents=True); target.write_bytes(content)
            cache_module.package(root/'cache', root/'one.tar'); cache_module.package(root/'cache', root/'two.tar')
            self.assertEqual((root/'one.tar').read_bytes(), (root/'two.tar').read_bytes())
            target.write_bytes(b'corrupted')
            with self.assertRaises(ValueError): cache_module.package(root/'cache', root/'bad.tar')
    def test_wrong_identity_and_duplicate_metadata(self):
        for blob in [archive({'name':'wrong','version':'1.0.0'}), archive({'name':'reviewed','version':'1.0.0'}, True)]:
            with self.assertRaises(ValueError): module.inspect_archive(blob, 'reviewed', '1.0.0')
    def test_accepts_verified_legacy_single_root(self):
        blob = archive({'name':'reviewed','version':'1.0.0'})
        source = io.BytesIO()
        with tarfile.open(fileobj=io.BytesIO(blob)) as old, tarfile.open(fileobj=source, mode='w:gz') as new:
            m = old.getmembers()[0]; payload = old.extractfile(m).read(); m.name = 'reviewed/package.json'; new.addfile(m, io.BytesIO(payload))
        self.assertEqual(module.inspect_archive(source.getvalue(), 'reviewed', '1.0.0')['hooks'], {})
    def test_inventories_hook_without_execution(self):
        pkg = {'name':'reviewed','version':'1.0.0','license':'MIT','scripts':{'postinstall':'exit 99'}}
        self.assertEqual(module.inspect_archive(archive(pkg),'reviewed','1.0.0')['hooks'], {'postinstall':'exit 99'})
    def test_reject_non_registry_origins_and_query(self):
        for url in ['https://registry.npmjs.org.evil.example/x', 'https://registry.npmjs.org/x?token=no', 'file:///tmp/package']:
            with self.assertRaises(ValueError): module.download(url)

if __name__ == '__main__': unittest.main()
