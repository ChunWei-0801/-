# 本次驗證紀錄

驗證日期：初版2026-10-14、新功能2026-10-15（Asia/Taipei，依使用者客戶端日期）。這是目前雲端執行個體的結果，
不代表已部署到 Render、已發布雲端快照或已在全新任務還原驗證。

| 檢查 | 實際結果 |
|---|---|
| 完整自動測試 | `cd backend && python -m pytest -q`：**735 passed**，35.01 秒，沒有失敗或跳過；1 個既有 Starlette/httpx 棄用提示 |
| API 實作／分工 | `python -m app.ownership`：**74/74** 業務接口，無未實作 stub，分工一致 |
| 登入背景功能 | 8,808,655-byte PNG 原始Blob保留、重載／重掛、4種選項、顯示方式與手機控制、無效圖片、quota暫用及重試、IndexedDB不可用與reset，功能檢查通過 |
| 前端 API 模式 | `node --test frontend/tests/api-mode.test.cjs`：**6 passed**，公開頁不能用 query 覆寫 API，mock 只在本機明確指定 |
| 依賴 | Python 3.12.14，Node 24.19.0；依 `backend/requirements.lock` 安裝，`python -m pip check` 通過 |
| PostgreSQL | Docker PostgreSQL 16，健康檢查通過，Alembic 0001 → 0002 → 0003、分類初始化通過 |
| SQLite | `python run.py --sqlite --port 5186 --api-port 8016`：0003遷移、登入與12.34實際寫入成功；SIGINT釋放前端及worker、重啟後同筆12.34保留，沒有覆寫.env |
| 真瀏覽器記帳 | 新註冊 → 略過理財設定 → 自動建立帳本 → 4 筆段落解析 → 缺值補45 → 確認寫入 → 列表4筆；收入30000、支出130 |
| 新手動金額與匯率 | 153法定貨幣真實行情，TWD結果帶入手動欄位；改實扣600.50再確認，source=manual，沒有NLP請求；總覽／統計表／圖表精確顯示600.50 |
| 真瀏覽器控管 | 餐飲預算1000，已花100；存款目標5000，可支配上限25000，剩餘可花24870；重讀後數值一致 |
| 手機版 | 390px 的七個主要頁面無橫向溢出；瀏覽器 page errors 為0 |
| 家庭 PostgreSQL | 建家庭201、產生子女邀請201、加入200、建立監管201；A讀B私人明細200，B讀A403，A改B交易403且金額未變；未登入401 |
| 真信箱驗證 | PostgreSQL開發模式request→單次連結confirm→emailVerified true；重用400、只保存雜湊；正式模式註冊無token、未驗證登入403，未配置發信時UI不可假寄信；外部Brevo尚未驗證 |
| 子女統計反向測試 | B以 `scope=family` 查詢回200，但只有自己的合法範圍（收入0、支出80、1筆），沒有A的收入112233；A授權範圍有兩人資料 |
| Docker 正式模式 | 依 backend/Dockerfile 建置成功；新版正式模式容器同源文件及DB就緒、未驗證註冊不發token、登入403、缺寄件服務503且不回開發驗證連結皆通過；原版登入查分類／登出失效也已驗證 |
| 信箱驗證 | 單次／過期／重寄／限次／雜湊與防自證測試；真PG開發連結→確認→重登入emailVerified；正式註冊不發token、未驗證403、無郵件設定不顯示demo連結 |
| 登入背景 | 三種預設＋自訂；8.8MB PNG原bytes/hash保留、重載恢復、容量不足暫用／重試、非法圖、清除、320–390px操作驗證通過 |
| 國際匯率 | 真CDN每日行情153法定幣、Decimal／快取／備援／過期與拒絕無行情測試；100USD=3218.08TWD，來源日期2026-10-14 |
| 實際金額帶入 | 匯率→TWD手動預填→改實際600.50→source=manual；0 NLP請求；總覽、統計表、圖表均正確顯示600.50，手機流程通過 |
| 教學互動 | 12張投影片、方向鍵、Home/End、講者備註、名詞搜尋、無搜尋結果與教學內容檢查通過，0 browser errors |
| PDF | 12頁完整簡報成功匯出；包括新增信箱／背景與手動／匯率，頁數與投影片數一致 |

Docker 建置曾遇到雲端代理的 CA 與 build namespace DNS 問題；以平台提供的
CA bundle 經 BuildKit secret、標準 proxy build args 及解析後的代理 hostname mapping
恢復驗證。沒有停用 TLS、使用 trusted-host 或更改檢查碼。
這是本雲端執行個體的網路處理，不需將平台代理位址或 CA 存入專案。

## 可重跑的檢查

先依根目錄 README 建立虛擬環境並啟動完整服務。自動測試使用獨立 SQLite，
不應拿正式使用者資料庫執行破壞性的測試。

```bash
cd backend
python -m pytest -q
python -m app.ownership
cd ..
node --test frontend/tests/api-mode.test.cjs
```

瀏覽器功能檢查使用 Playwright，在另一個測試工具目錄安裝即可，不用加入應用程式依賴：

```bash
npm install --prefix ../fambudget-browser-tools playwright
../fambudget-browser-tools/node_modules/.bin/playwright install chromium
```

在 macOS/Linux 開發 shell，設定 `PLAYWRIGHT_MODULE` 為該工具目錄的
`node_modules/playwright` 絕對路徑後執行：

```bash
node frontend/tests/browser-smoke.cjs
```

也可用預先安裝的 Chromium，透過 `CHROMIUM_EXECUTABLE` 指定路徑。
此腳本會建立虛構測試帳號與交易；僅對隔離的開發服務執行。
若使用不同網址，以 `FAMBUDGET_URL` 指定；啟動器使用不同埠號時，
用它印出的完整 `?api=` 本機網址設定正確接口。

## 尚未執行的外部項目

- 真實 LLM 服務、QLoRA 微調、人工留出集評測與模型準確率：**未執行**。
- Brevo 真實寄信：**未設定、未驗證**；正式信箱驗證需自己的金鑰與已驗證寄件人；本機開發連結明示沒有寄信。
- Render 公開站台：**未建立、未驗證**；部署指南及 Blueprint 已提供。
- 雲端環境發布與全新任務的快照還原：由平台的發布流程完成，**本次未驗證**。

規則解析與 mock 不列為模型成果；所有模型模擬測試只證明程式處理契約。

## 新功能瀏覽器回歸

設定 PLAYWRIGHT_MODULE 為已安裝的 Playwright 絕對路徑；若用平台提供的Chromium，也設定 CHROMIUM_EXECUTABLE。

```bash
node frontend/tests/login-background.test.cjs
node frontend/tests/new-features-smoke.cjs
```

兩個檢查會使用隔離的本機服務與虛構帳號／圖片。新功能煙霧檢查包括信箱開發驗證、匯率帶入、實扣600.50、手機版與零NLP呼叫，皆已通過。
正式真實發信沒有提供金鑰，因此不列為已通過的外部服務。

## 新功能瀏覽器回歸

本平台已提供 Playwright 與 Chromium，以下為此次實際使用的工具啟用方式：

```bash
PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node frontend/tests/login-background.test.cjs
PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node frontend/tests/new-features-smoke.cjs
```

前者測原照片保存／重載、配額退回、清除與手機操作；後者測新註冊／驗證、
匯率、手動實扣及小數正確顯示。正式環境的未驗證登入拒絕另經本機production設定驗證。
真正寄信需要自己的 Brevo 金鑰、已驗證寄件信箱和正確APP_BASE_URL，仍未外部送信。
