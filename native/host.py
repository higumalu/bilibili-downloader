"""Chrome native messaging host. stdout is reserved for framed JSON messages."""
import concurrent.futures
from collections import deque
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, parse_qs, urlencode

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import yt_dlp
from yt_dlp.extractor.bilibili import BiliBiliIE
from yt_dlp.networking import Request

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'config.json'
OUTPUT = Path.home() / 'Downloads' / 'Bilibili'
WRITE_LOCK = threading.Lock()
CANCEL = threading.Event()
JOB = None
PICKER = None
CONFIG_LOCK = threading.Lock()


def load_config():
    return json.loads(CONFIG.read_text(encoding='utf-8-sig')) if CONFIG.exists() else {}


def output_directory(config=None):
    config = load_config() if config is None else config
    return Path(config.get('output_directory') or OUTPUT).expanduser().resolve()


def settings_message(**extra):
    return {'type': 'settings', 'outputDirectory': str(output_directory()),
            'busy': bool(JOB and JOB.is_alive()), **extra}


def save_directory(directory):
    path = Path(directory).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise UserError('errorFolder')
    path = path.resolve()
    # Verify write access before remembering the selection.
    import tempfile
    with tempfile.TemporaryFile(dir=path):
        pass
    with CONFIG_LOCK:
        config = load_config()
        previous = str(output_directory(config))
        config['output_directory'] = str(path)
        config['output_directories'] = list(dict.fromkeys([
            *config.get('output_directories', []), previous, str(path)]))
        temporary = CONFIG.with_suffix('.tmp')
        temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(CONFIG)
    return path


def choose_directory(language="en"):
    try:
        result = subprocess.run([sys.executable, str(ROOT / 'pick_folder.py'), str(output_directory()), language],
            capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise UserError('errorFolderPicker')
        selected = json.loads(result.stdout.decode('utf-8'))
        if selected:
            save_directory(selected)
        send(settings_message(choosing=False))
    except Exception as exc:
        send(settings_message(choosing=False, errorKey=error_key(exc)))


def reveal_file(value):
    path = Path(value).resolve()
    config = load_config()
    roots = {OUTPUT.resolve(), output_directory(config)}
    roots.update(Path(item).resolve() for item in config.get('output_directories', []))
    if path.parent not in roots or not path.is_file():
        raise UserError('errorFileMissing')
    subprocess.Popen(['explorer.exe', '/select,', str(path)],
                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


class UserError(ValueError, RuntimeError):
    def __init__(self, key):
        self.key = key
        super().__init__(key)


def error_key(exc):
    if isinstance(exc, UserError):
        return exc.key
    if isinstance(exc, PermissionError) or getattr(exc, 'winerror', None) == 5:
        return 'errorPermission'
    if getattr(exc, 'errno', None) == errno.ENOSPC or getattr(exc, 'winerror', None) == 112:
        return 'errorDisk'
    message = str(exc).lower()
    if 'certificate' in message or 'cert_verify' in message:
        return 'errorTls'
    if any(word in message for word in ('login', 'premium', 'members', 'region', 'geo restrict', '登录', '會員', '会员')):
        return 'errorRestricted'
    return 'errorUnknown'


class Cancelled(Exception):
    pass


def send(message):
    data = json.dumps(message, ensure_ascii=False).encode('utf-8')
    with WRITE_LOCK:
        sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
        sys.stdout.buffer.flush()


def read_exact(stream, count):
    data = bytearray()
    while len(data) < count:
        block = stream.read(count - len(data))
        if not block:
            if not data:
                return None
            raise EOFError('Incomplete native message')
        data.extend(block)
    return bytes(data)


def receive(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    size = struct.unpack('<I', header)[0]
    if size > 4 * 1024 * 1024:
        raise ValueError('Message too large')
    body = read_exact(stream, size)
    if body is None:
        raise EOFError('Missing message body')
    return json.loads(body)


def validate_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in ('http', 'https') or parsed.hostname not in ('www.bilibili.com', 'bilibili.com')
            or not re.fullmatch(r'/video/BV[A-Za-z0-9]+/?', parsed.path) or parsed.username or parsed.password):
        raise UserError('errorUrl')
    page = int(parse_qs(parsed.query).get('p', ['1'])[0])
    if page < 1:
        raise UserError('errorPage')
    return f'https://www.bilibili.com{parsed.path}?{urlencode({"p": page})}', parsed.path.strip('/').split('/')[-1], page


def safe_name(title):
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(title)).strip(' .')[:100]
    if re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', text):
        text = '_' + text
    return text or 'Bilibili'


def allowed_cdn(url):
    parsed = urlsplit(url)
    hostname = parsed.hostname or ''
    return (parsed.scheme == 'https' and parsed.port in (None, 443) and not parsed.username
            and not parsed.password and any(hostname.endswith('.' + suffix)
            for suffix in ('bilivideo.com', 'bilivideo.cn', 'akamaized.net')))


def stream_urls(stream):
    urls = [stream.get('baseUrl') or stream.get('base_url') or stream.get('url')]
    urls.extend(stream.get('backupUrl') or stream.get('backup_url') or [])
    return list(dict.fromkeys(url for url in urls if isinstance(url, str) and allowed_cdn(url)))


def choose_streams(dash, height):
    videos = [v for v in dash.get('video', []) if stream_urls(v) and (not height or v.get('height', 0) <= height)]
    audios = [a for a in dash.get('audio', []) if stream_urls(a)]
    if not videos or not audios:
        raise UserError('errorStreams')
    # Prefer H.264 at the best available resolution for MP4 player compatibility.
    videos.sort(key=lambda v: (v.get('height', 0), str(v.get('codecs', '')).startswith('avc'), v.get('bandwidth', 0)), reverse=True)
    audio = max(audios, key=lambda a: a.get('bandwidth', 0))
    return videos[0], audio


class QuietLogger:
    def debug(self, *args): pass
    def warning(self, *args): pass
    def error(self, *args): pass


class BackupExtractor(BiliBiliIE):
    """Retain official backup URLs that the normal format list omits."""
    def _download_playinfo(self, *args, **kwargs):
        data = super()._download_playinfo(*args, **kwargs)
        if data and data.get('dash'):
            self.captured_dash = data['dash']
        return data


def make_downloader(config):
    return yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'logger': QuietLogger(),
        'socket_timeout': 25, 'noplaylist': True,
        'nocheckcertificate': bool(config.get('allow_insecure_tls', False))})


def extract(ydl, url):
    extractor = BackupExtractor(ydl)
    info = extractor.extract(url)
    dash = getattr(extractor, 'captured_dash', None)
    if not dash:
        videos, audio = [], []
        for fmt in info.get('formats', []):
            target = videos if fmt.get('height') else audio
            target.append({**fmt, 'baseUrl': fmt.get('url'), 'bandwidth': fmt.get('tbr', 0) or 0})
        dash = {'video': videos, 'audio': audio}
    return info.get('title', 'Bilibili'), dash


class Progress:
    def __init__(self, title):
        self.title = title
        self.parts = {}
        self.totals = {}
        self.lock = threading.Lock()
        self.last = 0
        self.transferred = 0
        self.samples = deque([(time.monotonic(), 0)])

    def update(self, key, size, total=None, cached=False):
        with self.lock:
            previous = self.parts.get(key, 0)
            self.parts[key] = size
            if not cached:
                self.transferred += max(0, size - previous)
            if total is not None:
                self.totals[key.split(':')[0]] = total
            now = time.monotonic()
            if now - self.last < .4:
                return
            self.last = now
            self.samples.append((now, self.transferred))
            while len(self.samples) > 2 and now - self.samples[0][0] > 8:
                self.samples.popleft()
            elapsed = now - self.samples[0][0]
            speed = (self.transferred - self.samples[0][1]) / elapsed if elapsed > .01 else 0
            done, total_size = sum(self.parts.values()), sum(self.totals.values())
            percent = min(97, done / total_size * 97) if total_size and len(self.totals) == 2 else 0
            eta = max(0, total_size - done) / speed if speed > 0 else None
            send({'type': 'progress', 'stage': 'downloading', 'title': self.title,
                  'percent': round(percent, 1), 'messageKey': 'downloading',
                  'args': {'done': f'{done / 1048576:.1f}', 'total': f'{total_size / 1048576:.1f}'},
                  'speedMB': speed / 1048576, 'etaSeconds': eta})


def check_cancel():
    if CANCEL.is_set():
        raise Cancelled()


def download_stream(ydl, stream, folder, label, headers, progress, workers):
    urls = stream_urls(stream)
    total = None
    node_errors = []
    for url in urls:
        check_cancel()
        try:
            with ydl.urlopen(Request(url, headers={**headers, 'Range': 'bytes=0-0'})) as response:
                content_range = response.headers.get('Content-Range', '')
                match = re.fullmatch(r'bytes 0-0/(\d+)', content_range)
                if response.status != 206 or not match:
                    raise ValueError('Node does not support range requests')
                total = int(match[1])
            break
        except Exception as exc:
            node_errors.append(exc)
            continue
    if not total:
        raise UserError('errorTls' if any('certificate' in str(e).lower() for e in node_errors) else 'errorNodes')
    # Bind cached chunks to the actual stream, independently of expiring query strings.
    identity = hashlib.sha256((urlsplit(urls[0]).path + str(total)).encode()).hexdigest()[:16]
    chunks = folder / (label + '-' + identity)
    chunks.mkdir(parents=True, exist_ok=True)
    progress.update(label + ':meta', 0, total)
    chunk_size = 8 * 1024 * 1024

    def part(start):
        end = min(start + chunk_size, total) - 1
        path = chunks / str(start)
        key = f'{label}:{start}'
        expected = end - start + 1
        if path.exists() and path.stat().st_size == expected:
            progress.update(key, expected, cached=True)
            return path
        error = None
        for attempt in range(4):
            for candidate in urls:
                check_cancel()
                progress.update(key, 0)
                try:
                    with ydl.urlopen(Request(candidate, headers={**headers, 'Range': f'bytes={start}-{end}'})) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{total}':
                            raise ValueError('Invalid Content-Range')
                        count = 0
                        with path.open('wb') as output:
                            while True:
                                check_cancel()
                                block = response.read(min(256 * 1024, expected - count + 1))
                                if not block:
                                    break
                                count += len(block)
                                if count > expected:
                                    raise ValueError('Range exceeds expected size')
                                output.write(block)
                                progress.update(key, count)
                    if path.stat().st_size != expected:
                        raise ValueError('Incomplete range')
                    return path
                except Cancelled:
                    raise
                except Exception as exc:
                    error = exc
            if CANCEL.wait(min(2 ** attempt, 8)):
                raise Cancelled()
        raise UserError(error_key(error) if error_key(error) != 'errorUnknown' else 'errorNodes')

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        paths = list(pool.map(part, range(0, total, chunk_size)))
    target = folder / (label + '.m4s')
    with target.open('wb') as output:
        for path in paths:
            check_cancel()
            with path.open('rb') as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
    return target


def run_download(request):
    try:
        url, bvid, page = validate_url(request['url'])
        height = int(request.get('height', 0))
        if height not in (0, 480, 720, 1080):
            raise UserError('errorQuality')
        config = load_config()
        output_root = output_directory(config)
        ffmpeg = config.get('ffmpeg') or shutil.which('ffmpeg')
        if not ffmpeg or not Path(ffmpeg).is_file():
            raise UserError('errorFfmpeg')
        output_root.mkdir(parents=True, exist_ok=True)
        send({'type': 'progress', 'stage': 'extracting', 'percent': 0, 'messageKey': 'extracting'})
        with make_downloader(config) as ydl:
            browser = request.get('info') or {}
            dash = browser.get('streams') if browser.get('page') == page and browser.get('bvid') == bvid else None
            title = browser.get('title', bvid)
            if not dash or not dash.get('video'):
                try:
                    title, dash = extract(ydl, url)
                except Exception as exc:
                    key = error_key(exc)
                    raise UserError(key if key != 'errorUnknown' else 'errorExtract') from exc
            check_cancel()
            video, audio = choose_streams(dash, height)
            title = f'{title}' + (f' P{page}' if page != 1 else '')
            stem = f'{safe_name(title)} [{bvid}] {video.get("height", "")}p'
            final = output_root / (stem + '.mp4')
            number = 1
            while final.exists():
                final = output_root / f'{stem} ({number}).mp4'
                number += 1
            folder = output_root / '.parts' / f'{bvid}-p{page}'
            folder.mkdir(parents=True, exist_ok=True)
            headers = {'Referer': url, 'User-Agent': 'Mozilla/5.0'}
            progress = Progress(title)
            workers = max(1, min(32, int(config.get('connections_per_stream', 16))))
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                jobs = [pool.submit(download_stream, ydl, stream, folder, label, headers, progress, workers)
                        for stream, label in [(video, 'video'), (audio, 'audio')]]
                try:
                    video_path, audio_path = [job.result() for job in jobs]
                except Exception:
                    CANCEL.set()
                    raise
        check_cancel()
        send({'type': 'progress', 'stage': 'merging', 'title': title, 'percent': 98, 'messageKey': 'merging'})
        temporary = folder / 'merged.mp4'
        log = folder / 'ffmpeg.log'
        with log.open('wb') as stderr:
            process = subprocess.Popen([ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
                '-i', str(video_path), '-i', str(audio_path), '-map', '0:v:0', '-map', '1:a:0',
                '-c', 'copy', '-movflags', '+faststart', str(temporary)],
                stdout=subprocess.DEVNULL, stderr=stderr, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            while process.poll() is None:
                if CANCEL.wait(.25):
                    process.terminate()
                    process.wait()
                    raise Cancelled()
            if process.returncode:
                raise UserError('errorDisk' if 'No space left' in log.read_text(encoding='utf-8', errors='replace') else 'errorMerge')
        if not temporary.is_file() or temporary.stat().st_size < 1024:
            raise UserError('errorMerge')
        temporary.rename(final)
        # Delete only the task's known temporary folder after successful merge.
        if folder.resolve().parent == (output_root / '.parts').resolve():
            shutil.rmtree(folder, ignore_errors=True)
        send({'type': 'done', 'title': title, 'percent': 100, 'path': str(final),
              'messageKey': 'done', 'args': {'height': video.get('height', ''), 'size': f'{final.stat().st_size / 1048576:.1f}'}})
    except Cancelled:
        send({'type': 'cancelled', 'messageKey': 'cancelled'})
    except Exception as exc:
        send({'type': 'error', 'messageKey': error_key(exc)})


def main():
    global JOB, PICKER
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    while (request := receive(sys.stdin.buffer)) is not None:
        command = request.get('command')
        if command == 'ping':
            send({'type': 'pong'})
        elif command == 'get_settings':
            send(settings_message(choosing=bool(PICKER and PICKER.is_alive())))
        elif command == 'choose_directory':
            if JOB and JOB.is_alive():
                send(settings_message(choosing=False, errorKey='errorBusyFolder'))
            elif not (PICKER and PICKER.is_alive()):
                send(settings_message(choosing=True))
                PICKER = threading.Thread(target=choose_directory, args=(request.get('language', 'en'),), daemon=True)
                PICKER.start()
        elif command == 'cancel':
            CANCEL.set()
        elif command == 'download':
            if PICKER and PICKER.is_alive():
                send({'type': 'error', 'messageKey': 'errorChoosing'})
            elif JOB and JOB.is_alive():
                send({'type': 'error', 'messageKey': 'errorBusy'})
            else:
                CANCEL.clear()
                JOB = threading.Thread(target=run_download, args=(request,), daemon=True)
                JOB.start()
        elif command == 'reveal':
            try:
                reveal_file(request['path'])
                send({'type': 'revealed'})
            except Exception as exc:
                send({'type': 'action_error', 'messageKey': error_key(exc)})
        else:
            send({'type': 'action_error', 'messageKey': 'errorCommand'})
    CANCEL.set()


if __name__ == '__main__':
    main()
