import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_release', ROOT / 'scripts' / 'build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_archive_is_reproducible_and_excludes_local_data(self):
        first = release.build()
        digest = hashlib.sha256(first.read_bytes()).hexdigest()
        second = release.build()
        self.assertEqual(digest, hashlib.sha256(second.read_bytes()).hexdigest())
        with zipfile.ZipFile(second) as archive:
            names = archive.namelist()
            self.assertTrue(any(n.endswith('/LICENSE') for n in names))
            self.assertTrue(any(n.endswith('/native/pick_folder.py') for n in names))
            self.assertTrue(any(n.endswith('/_locales/en/messages.json') for n in names))
            self.assertTrue(any(n.endswith('/_locales/zh_TW/messages.json') for n in names))
            for name in names:
                self.assertNotIn('.venv', name)
                self.assertNotIn('.browser-test', name)
                self.assertFalse(name.endswith(('config.json', 'launch.cmd', '.mp4', '.m4a', '.dump', '.log')))
                content = archive.read(name)
                self.assertNotRegex(content, rb'[?&](?:upsig|hdnts|SESSDATA)=[A-Za-z0-9%]{12,}')
            launcher = archive.read('bilibili-downloader/install.cmd')
            self.assertIn(b'\r\n', launcher)

    def test_fixed_extension_id_matches_public_manifest_key(self):
        import base64
        manifest = json.loads((ROOT / 'extension/manifest.json').read_text(encoding='utf8'))
        digest = hashlib.sha256(base64.b64decode(manifest['key'])).digest()[:16]
        actual = ''.join(chr(97 + nibble) for byte in digest for nibble in (byte >> 4, byte & 15))
        self.assertEqual(actual, (ROOT / 'extension-id.txt').read_text().strip())
