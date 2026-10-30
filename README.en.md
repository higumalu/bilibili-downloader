# Bilibili Downloader

**Windows + Google Chrome preview · Traditional Chinese / English · MIT**

[繁體中文](README.md) · [Privacy](PRIVACY.md) · [Changelog](CHANGELOG.md)

Download the current Bilibili BV video and merge its video/audio locally into MP4. Choose your destination and quality ceiling, with parallel chunks, official backup nodes, retries, download speed, and estimated time remaining.

## Install

1. Install **Python 3.10+ with Tcl/Tk**, and enable Add Python to PATH: [Python downloads](https://www.python.org/downloads/windows/).
2. Install **FFmpeg** and add its `bin` folder to PATH: [FFmpeg downloads](https://ffmpeg.org/download.html). Reopen your terminal after changing PATH.
3. Extract the project into a permanent folder and run **install.cmd**. It checks prerequisites, creates an isolated Python environment, installs pinned dependencies, and registers the native helper for your Windows account. Administrator privileges are not required.
4. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this project's **extension** folder.
5. Open a regular BV video page, click the extension, choose a folder and quality, then select **Add this video to queue**.

In v0.4.0, the button is **Add this video to queue**. Open other video pages and add them one by one. Two videos run concurrently by default; choose 1–3 using Concurrent videos. Lowering the limit leaves existing transfers running. Each task has independent progress, cancellation, retry, and file reveal. Duplicate pending video parts are rejected; retries join the end of the waiting queue.

Check prerequisites without installing or changing the registry:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -CheckOnly -Language en
```

The installer follows Windows language; override with `install.cmd -Language en` or `install.cmd -Language zh_TW`. The extension follows browser language initially, and remembers manual language changes.

## Storage and recovery

The default destination is `%USERPROFILE%\Downloads\Bilibili`. **Choose folder** opens the system dialog and remembers your selection. Cancelling the dialog keeps your setting. Folder changes are disabled during downloads. Existing videos are preserved by adding a filename suffix.

Keep Chrome open. Closing only the popup does not stop the download. Closing Chrome, reloading the extension, or losing the native helper interrupts it. Reopen the extension and select **Retry download** to fetch fresh stream URLs and reuse finished chunks. Downloads never restart automatically. Chunk reuse requires the same video part, stream, and destination. Failed/cancelled chunks remain under the destination's `.parts` folder; a successful merge removes that task's temporary files.

The queue survives Chrome restarts. Both running and waiting tasks become interrupted; select **Resume interrupted** to continue. A failed task does not stop other videos. Playback URLs are refreshed when each task starts; if its original tab was closed or navigated, unauthenticated native extraction is used and login-only qualities may be unavailable. Folder changes are blocked while any task is queued or downloading.

The queue retains up to 100 tasks. **Clear finished** removes completed, failed, and cancelled rows, while preserving interrupted tasks and all files. At capacity, the oldest finished row is evicted first; adding is refused if all 100 tasks still need attention.

The last 20 outcomes are kept locally, with **Show in folder** and **Clear history**. Clearing history does not delete videos, chunks, or the last task's retry metadata.

## Features and limitations

- Traditional Chinese / English interface, including runtime status and error guidance.
- Best available quality or a 1080p / 720p / 480p ceiling; H.264 preferred at the same resolution.
- Native folder picker, parallel range downloads, backup nodes, cancellation, retry, local MP4 merge.
- No analytics, relay server, exported browser cookies, or local HTTP service.
- Windows + Google Chrome and regular BV videos/current video part only. No live streams, series, playlist batch downloads, or automatic resume. macOS, Linux, and Edge have not been validated.
- Browser playback metadata is requested with the current page's login context when available; native fallback extraction is unauthenticated. Login, membership, region, and platform restrictions may limit availability or quality. The preview cannot guarantee every video works.
- Download only content you have permission to save, and respect applicable site rules. This project is not affiliated with or endorsed by Bilibili.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Native helper unavailable | Run install.cmd, then reload the extension. Keep the project in a fixed location. |
| Python or FFmpeg missing | Follow the setup instructions, add tools to PATH, and reopen the terminal. Python needs Tcl/Tk. |
| Folder dialog not visible | Check the taskbar for a background dialog; verify Tcl/Tk is installed. |
| Extraction fails / quality limited | Play the video in your browser first and check login, membership, and region availability. |
| Nodes fail | Retry to refresh the URLs, or try again later. |
| Permission / disk space error | Select a writable folder or free space, then retry. |
| Certificate error | Check Windows trusted certificates and proxy settings; keep TLS verification enabled. |

## Update and uninstall

After updating source, run install.cmd and reload at `chrome://extensions`. Settings and videos are kept. Rerun the installer if you move the project.

To unregister the helper, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1`, then remove the Chrome extension. Videos and config are kept. Delete the project folder and extension local storage separately if you want a full cleanup.

## Develop and release

Manifest V3 extension → Native Messaging → Python helper → FFmpeg. Permissions: activeTab, scripting, storage, nativeMessaging. There is no web-accessible local server.

```powershell
native\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test tests/*.test.js
python scripts/build_release.py
```

The release builder emits a source/install ZIP and SHA-256 checksum in `dist/`. A strict file allowlist excludes local settings, paths, media, and virtual environments. Python and FFmpeg remain prerequisites; their binaries are not bundled.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Manual testing](docs/TESTING.md) · [Third-party notices](NOTICE.md)

Project code is MIT licensed; dependencies retain their own licenses. Screenshots will be added after real Chrome acceptance testing, rather than presenting mockups as verified UI.
