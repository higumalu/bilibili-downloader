# 隱私說明 / Privacy

## 繁體中文

本專案沒有分析追蹤、遙測、廣告或中繼下載服務。網路請求送往 Bilibili 的網頁/API 與其影音 CDN；安裝依賴時 pip 會連線 Python 套件來源。

使用者按下下載後，插件會在目前影片頁請求影音資訊，可能使用該頁原有的登入狀態；不讀取、匯出或儲存瀏覽器 Cookie。當次取得的串流網址（可能含短期有效的簽章參數）透過 Chrome Native Messaging 傳給本機助手，僅在下載期間使用，不寫入下載紀錄。

Chrome 本機儲存區保存介面語言、畫質設定、儲存位置、下載狀態、最後任務的影片頁網址/標題/畫質、最多 20 筆下載結果（標題、完成路徑、時間、結果）。不使用 Chrome Sync。原生程式的 native/config.json 保存 FFmpeg 路徑、目前及歷史儲存資料夾、連線數與憑證選項。目的地的 .parts 可能保留取消或失敗任務的影音分段與 FFmpeg 錯誤紀錄。

v0.4.0 另保存最多 100 筆佇列任務（影片頁網址、標題、畫質、語言、分頁 ID、狀態、進度、時間及完成路徑）與同時下載數。分頁 ID 僅用來嘗試取得原影片頁的最新播放資訊，不儲存影音簽章網址。清除已結束項目只移除列表資料，不刪除檔案。

清除紀錄只刪除最近下載清單，不刪除檔案或重試資訊。移除插件可清除其本機資料；解除註冊助手不會刪除本機設定或影片。發布套件排除本機設定、紀錄、媒體與虛擬環境。

請勿在公開問題回報中張貼 Cookie、完整簽章影音網址、個人路徑或含隱私內容的截圖。

## English

No analytics, telemetry, ads, or relay download service. Runtime requests go to Bilibili pages/APIs and its media CDNs. Installing dependencies connects pip to Python package sources.

After a user starts a download, the extension requests playback metadata from the active video page, which may use that page's existing login context. Browser cookies are not read, exported, or stored. Temporary signed stream URLs are passed to the local helper through Chrome Native Messaging, used in memory during the download, and excluded from download history.

Chrome local storage holds language, quality, destination, current state, the last task's video-page URL/title/quality, and up to 20 outcomes (title, completed path, timestamp, result). Chrome Sync is not used. native/config.json stores the FFmpeg path, selected/current and previous destination folders, concurrency, and TLS settings. The destination's .parts folder can retain chunks and FFmpeg diagnostics from failed or cancelled tasks.

v0.4.0 also stores up to 100 queue tasks (video-page URL, title, quality, language, tab ID, status, progress, timestamps, completed path) and the concurrency limit. Tab IDs only help request fresh playback metadata from the original page. Signed media URLs are not persisted. Clear finished removes task rows, not files.

Clear history removes the recent outcomes list only, not files or retry metadata. Removing the extension clears its local data. Unregistering the helper keeps videos and local config. Release packages exclude local config, history, media, and virtual environments.

Do not post cookies, complete signed media URLs, personal filesystem paths, or private screenshots in public issues.
