# Acceptance checklist / 驗收清單

Automated: run Python unit/integration tests and Node tests. The merge integration test generates tiny local media and verifies both tracks with ffprobe. No automated test downloads full online videos.

Manual Windows + Chrome checks (record date, Chrome version, result; do not imply a pass without testing):

Preparation checks on 2026-10-31: Python and Node suites passed locally, including a generated-media FFmpeg merge, directory persistence, range fallback, restart/retry behavior in a mocked Chrome worker, locale parity, package exclusions, and deterministic ZIP checks. Installed native launcher framing was checked separately. These are not a clean-machine Chrome acceptance pass; the manual items below remain unverified.

- [ ] Clean install from the release ZIP on a machine without the development environment.
- [ ] Missing Python / Tcl/Tk and missing FFmpeg produce useful setup instructions.
- [ ] Load the unpacked extension and connect to the installed native host.
- [ ] Traditional Chinese and English switch all labels, status, and errors; selection survives reopening.
- [ ] Choose a writable folder with spaces and non-ASCII characters; cancel preserves the existing choice.
- [ ] Download a short permitted public BV video; verify playable video/audio and chosen path.
- [ ] Close/reopen the popup while downloading; transfer continues.
- [ ] Cancel; retry with fresh URLs; confirm compatible chunks are reused.
- [ ] Close/reopen Chrome; show interruption and require explicit retry.
- [ ] Fail one node; a supplied backup node succeeds.
- [ ] Read-only destination and disk-full cases show appropriate localized guidance.
- [ ] Reveal a completed file, change destination, reveal the earlier file from history.
- [ ] Clear history without deleting files. Confirm signed URLs/cookies are absent from local history.
- [ ] Uninstall removes only the native registration; existing videos are preserved.

Platform scope: Windows + Google Chrome only. Linux CI (if added) establishes unit-test portability, not desktop support.
