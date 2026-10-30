# Contributing / 貢獻

Issues and pull requests in English or Chinese are welcome. / 歡迎中文或英文的問題回報與 PR。

1. Keep the extension small and permissions limited. Use native messaging rather than a localhost server.
2. Add new UI text to both extension/_locales/en/messages.json and zh_TW/messages.json with identical placeholder names. Never put page titles into innerHTML.
3. Keep signed stream URLs, cookies, local config, media, and user paths out of fixtures, commits, releases, and public logs.
4. Run `python -m unittest discover -s tests -v` with native dependencies installed and `node --test tests/*.test.js`. FFmpeg/ffprobe enable the real merge integration test.
5. Use `python scripts/build_release.py` for release ZIPs. Review the archive and checksums before publishing.
6. Follow docs/TESTING.md for real Chrome checks. Mock-based tests do not establish a real browser acceptance pass.

The repository uses pinned runtime requirements and GitHub CI. To update yt-dlp, update the pin, run tests, and verify extraction against a public BV video without checking in its signed URLs.

By contributing, you agree that your original contributions are distributed under the project's MIT license. Third-party dependencies retain their own licenses.
