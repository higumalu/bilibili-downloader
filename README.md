# B站下載助手 / Bilibili Downloader

**Windows + Google Chrome 預覽版 · 繁體中文 / English · MIT**

[English documentation](README.en.md) · [隱私說明](PRIVACY.md) · [更新紀錄](CHANGELOG.md)

在 B 站一般 BV 影片頁按一下，將影音下載並在本機合併成 MP4。可選儲存資料夾、選畫質上限，會在節點失效時嘗試官方備用網址。

## 這個版本提供什麼

- 繁體中文與英文介面：首次依瀏覽器語言選擇，也可手動切換並記住設定。
- 系統資料夾選擇器、路徑顯示、同名檔案自動加編號。
- 最高可用畫質或最高 1080p / 720p / 480p；同畫質優先選 H.264。
- 分段平行下載、備用節點、失敗重試、速度與預估剩餘時間。
- 取消與重試；重新開啟 Chrome 後按重試，可重用相同串流已完成的分段。**不會自動恢復下載。**
- 最近 20 筆下載紀錄，可開啟檔案位置或清除紀錄。
- 無追蹤分析、不匯出 Cookie、不經過中繼下載伺服器。

## 安裝

1. 安裝含 **Tcl/Tk 的 Python 3.10+**，將 Python 加入 PATH：[Python 官方下載](https://www.python.org/downloads/windows/)。
2. 安裝 **FFmpeg** 並將其 `bin` 加入 PATH：[FFmpeg 官方下載](https://ffmpeg.org/download.html)。安裝後重新開啟終端。
3. 將專案解壓到固定資料夾，雙擊 `install.cmd`。會檢查環境、建立獨立 Python 環境並為目前 Windows 使用者註冊本機助手，不需管理員權限。
4. Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」，按「載入未封裝項目」，選擇本專案的 **extension** 子資料夾。
5. 開啟一般 BV 影片頁，點擴充功能 → 選資料夾與畫質 → **下載目前影片**。

可先執行環境檢查，不安裝或變更登錄檔：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -CheckOnly -Language zh_TW
```

安裝程式跟隨 Windows 語言，也可執行 `install.cmd -Language en` 或 `install.cmd -Language zh_TW`。插件內可隨時切換介面語言。

## 儲存、取消與重試

預設存至 `%USERPROFILE%\Downloads\Bilibili`。按「選擇儲存資料夾…」會記住新位置，取消選擇保留原設定。下載進行中無法變更位置。

保持 Chrome 開啟；關閉插件小視窗仍會繼續下載。關閉 Chrome、重新載入插件或本機助手中斷會停止任務。重新開啟後按 **重試下載**，會更新串流網址並重用已完成的分段。只有相同影片、分 P、串流和儲存位置的分段能重用。取消或失敗的分段保留在目的地的 `.parts`，成功合併後刪除該任務的暫存。

最近下載紀錄只存於 Chrome 本機儲存區，最多 20 筆；「清除紀錄」不會刪除影片、分段或上次任務的重試資訊。

## 常見問題

| 狀況 | 處理方式 |
| --- | --- |
| 無法連線到本機助手 | 執行 `install.cmd`，在擴充功能頁重新載入。確認整個套件未被移動。 |
| 找不到 Python 或 FFmpeg | 依安裝指引加入 PATH，再重開終端與安裝程式。Python 需包含 Tcl/Tk。 |
| 看不到資料夾選擇器 | 視窗可能在背景；查看工作列。確認 Python 安裝了 Tcl/Tk。 |
| 無法取得影片或畫質較低 | 先在瀏覽器播放影片；登入、會員、地區及站方限制會影響可用串流。 |
| 節點失效 | 按重試以重新解析網址；必要時稍後再試。 |
| 無法寫入／空間不足 | 選擇可寫入的資料夾或清出空間，再重試。 |
| 憑證驗證失敗 | 檢查 Windows 信任憑證與代理設定，不建議關閉驗證。 |

## 支援範圍

目前以 **Windows + Google Chrome、一般 BV 影片及目前分 P** 為主。不支援番劇、直播、合集批次下載，也未上架 Chrome 商店。macOS、Linux 和 Edge 尚未驗證。平台變動可能使解析失效，預覽版不保證每部影片可下載。

只下載你有權儲存的內容，並遵守適用的網站規範。此專案與 Bilibili 無關，未受其認可。

## 更新與移除

更新原始碼後重新執行 `install.cmd`，再於 `chrome://extensions` 重新載入。設定與已下載影片會保留。移動整個套件後也需重跑安裝程式。

解除安裝：執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1`，再移除 Chrome 插件。此操作不會刪除影片或設定；若要完全清除，可手動刪除專案資料夾及 Chrome 擴充功能的本機資料。

## 開發與發布

架構：Manifest V3 插件 → Chrome Native Messaging → 本機 Python 助手 → FFmpeg。沒有本機 HTTP 服務。插件僅要求 `activeTab`、`scripting`、`storage`、`nativeMessaging`。

```powershell
native\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test tests/*.test.js
python scripts/build_release.py
```

最後一個指令產生 `dist/bilibili-downloader-v0.3.0-windows.zip` 與 SHA-256 校驗檔，使用明確檔案清單排除設定、影片、虛擬環境及個人路徑。ZIP 包含原始碼與安裝程式，使用者仍需 Python 與 FFmpeg。

[貢獻指引](CONTRIBUTING.md) · [安全回報](SECURITY.md) · [手動驗收清單](docs/TESTING.md) · [依賴說明](NOTICE.md)

本專案程式碼採 MIT 授權，第三方工具依各自授權。介面截圖將在完成真實 Chrome 驗收後補入，避免將模擬畫面當成實測。
