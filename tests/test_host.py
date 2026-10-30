import importlib.util
import io
import json
from pathlib import Path
import struct
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host', Path(__file__).resolve().parents[1] / 'native' / 'host.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class PartialReader(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 2))


class Response(io.BytesIO):
    def __init__(self, data, start, end, total, bad_range=False):
        super().__init__(data)
        self.status = 206
        self.headers = {'Content-Range': 'bytes 0-1/2' if bad_range else f'bytes {start}-{end}/{total}'}


class FakeDownloader:
    def __init__(self, data, bad_range=False):
        self.data = data
        self.bad_range = bad_range
        self.urls = []
        self.transfers = 0

    def urlopen(self, request):
        self.urls.append(request.url)
        if 'broken.' in request.url:
            raise OSError('HTTP 567')
        start, end = map(int, request.headers['Range'].removeprefix('bytes=').split('-'))
        if end > 0:
            self.transfers += 1
        return Response(self.data[start:end + 1], start, end, len(self.data), self.bad_range and end > 0)


class HostTests(unittest.TestCase):
    def setUp(self):
        host.CANCEL.clear()

    def test_native_framing_handles_partial_reads_and_unicode(self):
        payload = json.dumps({'title': '躍遷'}).encode('utf8')
        self.assertEqual(host.receive(PartialReader(struct.pack('<I', len(payload)) + payload)), {'title': '躍遷'})
        self.assertIsNone(host.receive(io.BytesIO()))
        with self.assertRaises(ValueError):
            host.receive(io.BytesIO(struct.pack('<I', 10 * 1024 * 1024)))
        with self.assertRaises(EOFError):
            host.receive(io.BytesIO(struct.pack('<I', 50) + b'{}'))

    def test_rejects_non_bilibili_urls_and_invalid_pages(self):
        for url in ['https://evil.test/video/BV123', 'https://bilibili.com.evil.test/video/BV123',
                    'file:///video/BV123', 'https://www.bilibili.com/video/BV123?p=-1']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                host.validate_url(url)
        normalized, bvid, page = host.validate_url('https://www.bilibili.com/video/BV13cxv6SEXT/?p=2&x=bad')
        self.assertEqual((bvid, page), ('BV13cxv6SEXT', 2))
        self.assertNotIn('x=bad', normalized)

    def test_cdn_allowlist(self):
        self.assertFalse(host.allowed_cdn('http://localhost/a'))
        self.assertFalse(host.allowed_cdn('https://bilivideo.com.evil.test/a'))
        self.assertFalse(host.allowed_cdn('https://user:pass@cdn.bilivideo.com/a'))
        self.assertTrue(host.allowed_cdn('https://upos-hz-mirrorakam.akamaized.net/a'))

    def test_quality_ceiling_and_mp4_codec_preference(self):
        def stream(height, codec, bandwidth):
            return {'height': height, 'codecs': codec, 'bandwidth': bandwidth, 'baseUrl': 'https://cdn.bilivideo.com/a'}
        dash = {'video': [stream(1080, 'avc1', 800), stream(720, 'av01', 900), stream(720, 'avc1', 500)],
                'audio': [stream(0, 'mp4a', 90)]}
        video, audio = host.choose_streams(dash, 720)
        self.assertEqual((video['height'], video['codecs']), (720, 'avc1'))
        self.assertEqual(host.choose_streams(dash, 0)[0]['height'], 1080)

    @patch.object(host, 'send')
    def test_backup_download_and_cached_chunk_reuse(self, send):
        data = bytes(range(256)) * 32
        fake = FakeDownloader(data)
        stream = {'baseUrl': 'https://broken.bilivideo.com/video', 'backupUrl': ['https://working.bilivideo.com/video']}
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            result = host.download_stream(fake, stream, folder, 'video', {}, host.Progress('test'), 2)
            self.assertEqual(result.read_bytes(), data)
            self.assertTrue(any('working.' in url for url in fake.urls))
            transfer_count = fake.transfers
            result = host.download_stream(fake, stream, folder, 'video', {}, host.Progress('test'), 2)
            self.assertEqual(result.read_bytes(), data)
            self.assertEqual(fake.transfers, transfer_count)

    @patch.object(host, 'send')
    def test_rejects_wrong_range_even_if_length_is_correct(self, send):
        with tempfile.TemporaryDirectory() as directory, patch.object(host.CANCEL, 'wait', return_value=False):
            with self.assertRaises(RuntimeError):
                host.download_stream(FakeDownloader(b'x' * 4096, bad_range=True),
                    {'baseUrl': 'https://cdn.bilivideo.com/v'}, Path(directory), 'video', {}, host.Progress('test'), 1)

    @patch.object(host, 'send')
    def test_cancellation_before_network(self, send):
        host.CANCEL.set()
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(host.Cancelled):
            host.download_stream(FakeDownloader(b'abc'), {'baseUrl': 'https://cdn.bilivideo.com/v'},
                                 Path(directory), 'video', {}, host.Progress('test'), 1)

    def test_windows_safe_filenames(self):
        self.assertEqual(host.safe_name('CON'), '_CON')
        self.assertNotIn('/', host.safe_name('影片/測試.mp4'))

    def test_directory_setting_persists_and_keeps_other_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selected = root / '自訂 影片'
            selected.mkdir()
            config = root / 'config.json'
            config.write_text(json.dumps({'ffmpeg': 'keep-ffmpeg', 'connections_per_stream': 8}))
            with patch.object(host, 'CONFIG', config):
                host.save_directory(str(selected))
                self.assertEqual(host.output_directory(), selected.resolve())
                saved = host.load_config()
                self.assertEqual(saved['ffmpeg'], 'keep-ffmpeg')
                self.assertEqual(saved['connections_per_stream'], 8)
                self.assertIn(str(selected.resolve()), saved['output_directories'])
                with self.assertRaises(ValueError):
                    host.save_directory(str(root / 'missing'))
                self.assertEqual(host.output_directory(), selected.resolve())

    def test_cancelled_folder_picker_preserves_setting(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config.json'
            original = json.dumps({'output_directory': directory, 'ffmpeg': 'keep'})
            config.write_text(original)
            result = subprocess.CompletedProcess([], 0, stdout=b'""', stderr=b'')
            with patch.object(host, 'CONFIG', config), patch.object(host.subprocess, 'run', return_value=result), \
                    patch.object(host, 'send') as send:
                host.choose_directory()
            self.assertEqual(config.read_text(), original)
            self.assertFalse(send.call_args[0][0]['choosing'])
            self.assertNotIn('error', send.call_args[0][0])

    def test_reveal_accepts_previous_destination_and_rejects_unselected_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'old'
            old.mkdir()
            allowed = old / 'film.mp4'
            allowed.write_bytes(b'video')
            denied = root / 'other.mp4'
            denied.write_bytes(b'video')
            config = root / 'config.json'
            config.write_text(json.dumps({'output_directories': [str(old)]}))
            with patch.object(host, 'CONFIG', config), patch.object(host.subprocess, 'Popen') as launch:
                host.reveal_file(str(allowed))
                launch.assert_called_once()
                with self.assertRaises(ValueError):
                    host.reveal_file(str(denied))

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_full_job_merges_media_and_keeps_existing_download(self):
        ffmpeg = shutil.which('ffmpeg')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video, audio = root / 'v.mp4', root / 'a.m4a'
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            subprocess.run([ffmpeg, '-loglevel', 'error', '-f', 'lavfi', '-i',
                'color=c=blue:s=128x72:d=0.3', '-c:v', 'libx264', '-y', str(video)], check=True, creationflags=flags)
            subprocess.run([ffmpeg, '-loglevel', 'error', '-f', 'lavfi', '-i',
                'sine=frequency=440:duration=0.3', '-c:a', 'aac', '-y', str(audio)], check=True, creationflags=flags)
            output = root / 'output'
            output.mkdir()
            existing = output / '測試 [BV123] 72p.mp4'
            existing.write_bytes(b'keep existing file')
            class MediaDownloader(FakeDownloader):
                def __enter__(self): return self
                def __exit__(self, *args): pass
                def urlopen(self, request):
                    self.data = video.read_bytes() if '/video' in request.url else audio.read_bytes()
                    return super().urlopen(request)
            request = {'url': 'https://www.bilibili.com/video/BV123/', 'height': 0,
                'info': {'bvid': 'BV123', 'page': 1, 'title': '測試', 'streams': {
                    'video': [{'height': 72, 'baseUrl': 'https://cdn.bilivideo.com/video'}],
                    'audio': [{'baseUrl': 'https://cdn.bilivideo.com/audio'}]}}}
            config = root / 'config.json'
            config.write_text(json.dumps({'ffmpeg': ffmpeg, 'output_directory': str(output)}), encoding='utf8')
            with patch.object(host, 'OUTPUT', root / 'unused-default'), patch.object(host, 'CONFIG', config), \
                    patch.object(host, 'make_downloader', return_value=MediaDownloader(b'')), \
                    patch.object(host, 'send') as send:
                host.run_download(request)
            result = send.call_args[0][0]
            self.assertEqual(result['type'], 'done', result)
            self.assertEqual(existing.read_bytes(), b'keep existing file')
            target = Path(result['path'])
            self.assertTrue(target.name.endswith('(1).mp4'))
            probe = subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-show_entries',
                'stream=codec_type', '-of', 'json', str(target)], capture_output=True, check=True, creationflags=flags)
            streams = json.loads(probe.stdout)['streams']
            self.assertEqual({s['codec_type'] for s in streams}, {'video', 'audio'})
            self.assertFalse((output / '.parts' / 'BV123-p1').exists())


if __name__ == '__main__':
    unittest.main()
