"""Explicit OS/guest simulations. No KVM, systemd, guest or containment evidence."""
import contextlib
import hashlib
import hmac
import importlib.util
import json
import io
import tarfile
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
import stat
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


host = module('forge_host', 'runner/host/linux_helper.py')
guest = module('forge_guest', 'runner/guest/agent.py')
packager = module('forge_packager', 'runner/image/assemble.py')


def descriptor():
    ids = {k: '00000000-0000-4000-8000-' + str(i).zfill(12) for i, k in enumerate(('operationId', 'environmentId', 'appDatabaseId', 'workspaceId', 'projectId', 'jobId'), 1)}
    return {**ids, 'sourceManifestDigest': 'a' * 64, 'templateDigest': 'b' * 64, 'commandPolicyDigest': 'c' * 64,
            'executionReviewDigest': 'd' * 64, 'imageDigest': 'sha256:' + 'e' * 64,
            'issuedAt': '2026-09-09T12:00:00.000Z', 'expiresAt': '2026-09-09T12:01:00.000Z', 'leaseEpoch': 1,
            'network': {'internet': False, 'appDatabase': 'guest-loopback', 'maxConnections': 5},
            'resources': {'cpu': 2, 'memoryMiB': 4096, 'diskMiB': 8192, 'processes': 512, 'activeMs': 1200000, 'verificationMs': 600000, 'logBytes': 10485760}}


class HostSimulation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.patches = [patch.object(host, 'ROOT', self.root), patch.object(host, 'JAILS', self.root / 'jails'),
                        patch.object(host, 'locked', contextlib.nullcontext), patch.object(host, 'protected_directory', return_value=True), patch.object(host, 'now', return_value=host.millis(descriptor()['issuedAt'])),
                        patch.object(host, 'preflight', return_value={'capacity': {'guests': 2, 'cpu': 4, 'memoryMiB': 8192, 'diskMiB': 16384}})]
        for p in self.patches:
            p.start()
        self.d = descriptor(); self.attempt = '00000000-0000-4000-8000-000000000099'

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def call(self, action, attempt=None):
        return host.dispatch({'action': action, 'descriptor': self.d, 'attemptId': attempt})

    def test_intent_precedes_launch_and_duplicate_cannot_relaunch(self):
        def launch(record, cfg):
            self.assertTrue((self.root / (self.d['operationId'] + '.json')).exists())
            self.assertEqual(record['binding'], host.binding(self.d))
        with patch.object(host, 'start', side_effect=launch) as start:
            self.call('launch', self.attempt)
            with self.assertRaises(ValueError):
                self.call('launch', self.attempt)
            self.assertEqual(start.call_count, 1)

    def test_failed_delayed_create_persists_tombstone(self):
        with patch.object(host, 'start', side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                self.call('launch', self.attempt)
        record = json.loads((self.root / (self.d['operationId'] + '.json')).read_text())
        self.assertTrue(record['tombstone'])
        with self.assertRaises(ValueError):
            self.call('binding')

    def test_destroy_before_create_and_changed_attempt_fenced(self):
        self.call('revoke', self.attempt)
        with patch.object(host, 'start') as start:
            with self.assertRaises(ValueError):
                self.call('launch', self.attempt)
            start.assert_not_called()
        with self.assertRaises(ValueError):
            self.call('observe', '00000000-0000-4000-8000-000000000098')

    def test_expired_binding_and_new_epoch_fenced(self):
        with patch.object(host, 'start'):
            self.call('launch', self.attempt)
        with patch.object(host, 'now', return_value=host.millis(self.d['expiresAt'])):
            with self.assertRaises(ValueError):
                self.call('binding')
        self.d = {**self.d, 'leaseEpoch': 2}
        with self.assertRaises(ValueError):
            self.call('binding')

    def test_failed_stop_cannot_wipe_or_release_volume(self):
        with patch.object(host, 'start'):
            self.call('launch', self.attempt)
        record = json.loads((self.root / (self.d['operationId'] + '.json')).read_text())
        host.jail(record).mkdir(parents=True)
        record['jailCreated'] = True
        (self.root / (self.d['operationId'] + '.json')).write_text(json.dumps(record))
        with patch.object(host, 'inactive', return_value=False):
            with self.assertRaises(ValueError):
                self.call('wipe')
        self.assertTrue(host.jail(record).exists())
        with patch.object(host, 'inactive', return_value=True):
            self.call('wipe')
            observation = self.call('observe', self.attempt)
            self.assertTrue(observation['volumesAbsent'])
            self.assertTrue(observation['appCredentialsAbsent'])

    def test_revoke_without_attempt_adopts_supervisor_attempt_only_for_cleanup(self):
        self.call('revoke')
        with patch.object(host, 'stop'):
            self.call('stop', self.attempt)
        record = json.loads((self.root / (self.d['operationId'] + '.json')).read_text())
        self.assertEqual(record['attempt'], self.attempt)
        with self.assertRaises(ValueError):
            self.call('launch', self.attempt)

    def test_real_launcher_plan_uses_no_nic_pinned_assets_and_hard_quotas(self):
        assets = {}
        for name in ('guestKernel', 'guestRootfs', 'seccompFilter', 'jailer', 'firecracker'):
            path = self.root / name; path.write_bytes(b'fixture bytes')
            assets[name] = {'path': str(path)}
        record = {'descriptor': self.d, 'attempt': self.attempt, 'uid': 10000, 'key': '11' * 32}
        calls = []
        (host.JAILS / 'firecracker').mkdir(parents=True)
        def run(args):
            calls.append(args)
            if args[0] in ('/usr/bin/fallocate', '/usr/bin/truncate'):
                Path(args[-1]).touch()
            return ''
        with patch.object(host, 'run', side_effect=run), patch.object(host.os, 'chown'):
            host.start(record, {'image': {'assets': assets}})
        configuration = json.loads((host.jail(record) / 'firecracker.json').read_text())
        self.assertEqual(configuration['network-interfaces'], [])
        self.assertEqual(configuration['vsock'], {'guest_cid': 3, 'uds_path': '/rpc.sock'})
        self.assertTrue(configuration['drives'][0]['is_read_only'])
        self.assertTrue(configuration['drives'][2]['is_read_only'])
        launcher = calls[-1]
        self.assertIn('--property=PrivateNetwork=yes', launcher)
        self.assertIn('--property=MemorySwapMax=0', launcher)
        self.assertIn('--property=TasksMax=128', launcher)
        self.assertIn('--seccomp-filter', launcher)
        self.assertNotIn('--no-seccomp', launcher)
        self.assertIn('--watch', calls[-2])
        self.assertNotIn('DATABASE_URL', ' '.join(launcher))

    def test_stop_masks_before_stop_and_reobserves_systemd(self):
        record = {'attempt': self.attempt}
        calls = []
        with patch.object(host, 'run', side_effect=lambda args: calls.append(args) or ''), patch.object(host, 'inactive', side_effect=[False, True]):
            host.stop(record)
        self.assertIn('mask', calls[0]); self.assertIn('daemon-reload', calls[1]); self.assertIn('kill', calls[2]); self.assertIn('stop', calls[3])

    def test_quota_and_network_validation(self):
        for key, value in [('cpu', 3), ('memoryMiB', 4097), ('processes', 513), ('diskMiB', 8193)]:
            d = descriptor(); d['resources'][key] = value
            with self.assertRaises(ValueError):
                host.validate(d, self.attempt)
        d = descriptor(); d['network']['internet'] = True
        with self.assertRaises(ValueError):
            host.validate(d, self.attempt)

    def test_watchdog_expiry_persists_fence_before_kill(self):
        with patch.object(host, 'start'):
            self.call('launch', self.attempt)
        def stop(record):
            persisted = json.loads((self.root / (self.d['operationId'] + '.json')).read_text())
            self.assertTrue(persisted['tombstone'])
            raise InterruptedError('end simulated watchdog')
        with patch.object(host, 'now', return_value=host.millis(self.d['expiresAt'])), patch.object(host, 'stop', side_effect=stop):
            with self.assertRaises(InterruptedError):
                host.watch(self.d['operationId'])


class GuestSimulation(unittest.TestCase):
    def setUp(self):
        self.agent = guest.Agent({'descriptor': descriptor(), 'attemptId': 'attempt-fixture', 'key': '11' * 32}, clock=lambda: host.millis(descriptor()['issuedAt']) / 1000)

    def envelope(self, action='unknown'):
        d = descriptor()
        body = {'schemaVersion': 1, 'requestId': 'request-fixture', 'operationId': d['operationId'], 'attemptId': 'attempt-fixture',
                'sourceManifestDigest': d['sourceManifestDigest'], 'imageDigest': d['imageDigest'], 'leaseEpoch': 1, 'expiresAt': d['expiresAt'], 'action': action, 'input': {}}
        return {**body, 'mac': hmac.new(self.agent.key, guest.canonical(body).encode(), hashlib.sha256).hexdigest()}

    def test_rpc_mac_and_response_request_digest(self):
        envelope = self.envelope(); original = dict(envelope); original.pop('mac')
        response = self.agent.request(envelope)
        self.assertFalse(response['ok']); self.assertIsNone(response['output'])
        self.assertEqual(response['requestDigest'], guest.digest(original))
        mac = response.pop('mac')
        self.assertEqual(mac, hmac.new(self.agent.key, guest.canonical(response).encode(), hashlib.sha256).hexdigest())

    def test_replay_wrong_key_and_wrong_source_reject(self):
        self.agent.request(self.envelope())
        with self.assertRaises(ValueError):
            self.agent.request(self.envelope())
        body = self.envelope(); body['mac'] = '00' * 32
        with self.assertRaises(ValueError):
            self.agent.request(body)
        body = self.envelope(); body['sourceManifestDigest'] = 'f' * 64
        with self.assertRaises(ValueError):
            self.agent.request(body)

    def test_expired_and_unbounded_rpc_lease_reject_before_handler_or_epoch(self):
        for expiry in ('2026-09-09T11:59:59.000Z', '2026-09-09T12:01:01.000Z', 'invalid', '2026-09-09T12:00:10'):
            body = self.envelope(); body.pop('mac'); body['expiresAt'] = expiry; body['leaseEpoch'] = 2
            envelope = {**body, 'mac': hmac.new(self.agent.key, guest.canonical(body).encode(), hashlib.sha256).hexdigest()}
            with patch.object(self.agent, 'handle') as handle:
                with self.assertRaises(ValueError):
                    self.agent.request(envelope)
                handle.assert_not_called()
            self.assertEqual(self.agent.epoch, 1)
            self.assertEqual(self.agent.seen, set())

    def test_credentials_are_random_disjoint_and_absent_from_base_environment(self):
        other = guest.Agent({'descriptor': descriptor(), 'attemptId': 'other', 'key': '22' * 32})
        self.assertEqual(len({self.agent.app_password, self.agent.migrator_password, other.app_password, other.migrator_password}), 4)
        self.assertNotIn('DATABASE_URL', guest.ENV)
        self.assertFalse(any('KEY' in key or 'TOKEN' in key or 'PASSWORD' in key for key in guest.ENV))

    def test_hostile_paths_and_guest_commands_denied(self):
        for path in ('../etc/passwd', '/etc/passwd', 'a//b', 'a/./b', 'a\\b', 'a\x00b'):
            with self.assertRaises(ValueError):
                guest.safe_path(path)
        self.agent.sealed = True
        for check in ('bash', 'npm install', 'migration-prior', 'source-policy'):
            with self.assertRaises(ValueError):
                self.agent.command(check, 1000)

    def test_app_unit_has_aggregate_caps_and_no_rpc_family_or_migrator_secret(self):
        self.agent.db_ready = True
        argv = self.agent.app_unit('fixture', 1000)
        text = '\n'.join(argv)
        self.assertIn('Slice=forge-app.slice', text)
        self.assertIn('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6', text)
        self.assertNotIn(self.agent.migrator_password, text)
        self.assertNotIn(self.agent.key.hex(), text)
        self.assertIn('forge_app:' + self.agent.app_password, text)

    def test_canonical_utf16_unicode_vector(self):
        value = {'z': 0, '\U0001f600': 'é', '\ue000': True, 'a': [None, '\n', 2]}
        self.assertEqual(guest.canonical(value), '{"a":[null,"\\n",2],"z":0,"😀":"é","\ue000":true}')
        self.assertEqual(host.canonical(value), guest.canonical(value))


class DirectorySafetySimulation(unittest.TestCase):
    def test_jail_ancestor_symlink_and_group_writable_directory_reject(self):
        target = Path('/var/lib/forge/jailer')
        def inspect(path, bad_mode=None, bad_uid=0):
            return SimpleNamespace(st_mode=bad_mode if path == Path('/var/lib/forge') else stat.S_IFDIR | 0o755, st_uid=bad_uid if path == Path('/var/lib/forge') else 0)
        for mode, uid in [(stat.S_IFLNK | 0o777, 0), (stat.S_IFDIR | 0o775, 0), (stat.S_IFDIR | 0o755, 1000)]:
            with self.assertRaisesRegex(ValueError, 'Unprotected'):
                host.protected_directory(target, inspect=lambda p: inspect(p, mode, uid))
        self.assertTrue(host.protected_directory(target, inspect=lambda p: inspect(p, stat.S_IFDIR | 0o755)))

    def test_preexisting_attempt_rejects_before_any_image_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            record = {'descriptor': descriptor(), 'attempt': 'fixture-attempt', 'uid': 10000, 'key': '11' * 32}
            with patch.object(host, 'JAILS', root), patch.object(host, 'protected_directory', return_value=True):
                host.jail(record).parent.mkdir(parents=True)
                with patch.object(host.shutil, 'copyfile') as copy:
                    with self.assertRaises(FileExistsError):
                        host.start(record, {'image': {'assets': {}}})
                    copy.assert_not_called()
                with self.assertRaisesRegex(ValueError, 'unowned'):
                    host.checked_jail_parent(record)


class PackagingSimulation(unittest.TestCase):
    def test_prepared_cache_matches_archive_bytes_and_rejects_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); cache = root / 'cache'; relative = '_cacache/content-v2/sha512/aa/fixture'
            path = cache / relative; path.parent.mkdir(parents=True); path.write_bytes(b'fixture')
            archive = root / 'cache.tar'
            with tarfile.open(archive, 'w') as output:
                member = tarfile.TarInfo(relative); member.size = 7
                output.addfile(member, io.BytesIO(b'fixture'))
            packager.verify_cache(archive, cache)
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                packager.verify_cache(archive, cache)

    def test_cache_links_and_noncanonical_manifest_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root / 'cache.tar'
            with tarfile.open(archive, 'w') as output:
                member = tarfile.TarInfo('_cacache/content-v2/sha512/aa/link'); member.type = tarfile.SYMTYPE; member.linkname = '/etc/passwd'
                output.addfile(member)
            with self.assertRaises(ValueError):
                packager.verify_cache(archive, root)
        with self.assertRaises(ValueError):
            packager.canonical({'version': 1.5})
        self.assertEqual(packager.canonical({'z': 2, 'a': 'fixture'}), guest.canonical({'z': 2, 'a': 'fixture'}))


if __name__ == '__main__':
    unittest.main()
