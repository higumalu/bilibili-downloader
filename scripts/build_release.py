"""Build an allowlisted, reproducible source/install ZIP without local data."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOP_LEVEL = [
    '.gitignore', '.gitattributes',
    'README.md', 'README.en.md', 'LICENSE', 'NOTICE.md', 'PRIVACY.md',
    'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'install.cmd',
    'install.ps1', 'uninstall.ps1', 'uninstall.cmd', 'extension-id.txt', 'package.json',
]
NATIVE = ['host.py', 'pick_folder.py', 'requirements.txt', 'installer_strings.json']


def release_files():
    files = [ROOT / name for name in TOP_LEVEL]
    files += [ROOT / 'native' / name for name in NATIVE]
    for folder, extensions in [('extension', {'.js', '.html', '.css', '.json', '.png'}),
                               ('docs', {'.md', '.png'}), ('tests', {'.py', '.js'}),
                               ('.github', {'.yml', '.md'})]:
        files += [path for path in (ROOT / folder).rglob('*')
                  if path.is_file() and path.suffix in extensions and '__pycache__' not in path.parts]
    files.append(Path(__file__).resolve())
    return sorted(set(files))


def build():
    version = json.loads((ROOT / 'extension/manifest.json').read_text(encoding='utf8'))['version']
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    archive_path = output / f'bilibili-downloader-v{version}-windows.zip'
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in release_files():
            relative = path.relative_to(ROOT).as_posix()
            data = path.read_bytes()
            if path.suffix != '.png':
                data = data.replace(b'\r\n', b'\n')
            if path.suffix in {'.cmd', '.ps1'}:
                data = data.replace(b'\n', b'\r\n')
            entry = zipfile.ZipInfo('bilibili-downloader/' + relative, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, data)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum = archive_path.with_suffix('.zip.sha256')
    checksum.write_text(f'{digest}  {archive_path.name}\n', encoding='ascii')
    print(f'{archive_path.name}: {digest}')
    return archive_path


if __name__ == '__main__':
    build()
