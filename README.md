# 家庭記帳與財務控管系統 · FamBudget

以「能啟動、能實際記帳、能說明、能發表」為目標整理的專題。
前端採 HTML / CSS / JavaScript，後端採 FastAPI，資料庫支援 PostgreSQL 與本機 SQLite。
目前未提供微調模型或人工留出集；沒有設定模型服務時，畫面會清楚標示「規則解析」。

## 下載專題與操作簡報

在本 GitHub 頁面按 **Code → Download ZIP**，解壓縮後進入包含 `run.py`、
`backend/`、`frontend/` 的資料夾，再依下方指令啟動。

- [36 頁 PowerPoint 操作使用手冊（可編輯）](docs/fambudget-user-guide.pptx)
- [相同內容的 PDF 操作使用手冊](docs/fambudget-user-guide.pdf)
- [第一次使用與啟動步驟](docs/開始使用.md)

開啟 PPT 檔案頁後，按 **Download raw file** 下載；PDF 也可在 GitHub 預覽或下載。
簡報涵蓋實際介面、信箱驗證、四種登入背景、手動與文字解析記帳、匯率、家庭與手機操作。
這是原始碼儲存庫；實際網站需要先啟動或依部署指南建立自己的公開服務。

## 先開始，再看原理

1. **第一次啟動**：依下方指令建立 Python 環境並啟動。
2. **跟著操作**：[逐步教學](frontend/docs/tutorial.html)、[操作手冊](frontend/docs/guide.html)。
3. **準備發表**：[12 張投影簡報](frontend/docs/presentation.html)、[發表與驗收手冊](docs/04-發表與驗收手冊.md)。
4. **解釋技術**：[可搜尋中英名詞表](frontend/docs/glossary.html)、[FastAPI](frontend/docs/fastapi.html)、[RESTful](frontend/docs/restful.html)。
5. **新功能教學**：[信箱、背景、實際金額與匯率](docs/08-信箱背景手動記帳與匯率.md)。
6. **準備上線**：[部署指南](docs/05-部署指南.md)、[驗證紀錄](docs/VALIDATION.md)。

文件皆可在專案啟動後透過前端的「教學」「名詞」「發表」入口閱讀。
簡報支援方向鍵、講者備註與列印為 PDF，不需要外部簡報工具。

## 啟動：先用免 Docker 展示模式

需要 **Python 3.12**（已驗證版本），Node.js 用於開發測試，不是使用網站的必要條件。
請先進入同時含有 `backend/`、`frontend/`、`run.py` 的專案根目錄。

```bash
python -m venv .venv
```

Windows：

```powershell
.\.venv\Scripts\python.exe run.py --sqlite
```

macOS / Linux：

```bash
./.venv/bin/python run.py --sqlite
```

第一次會依 `backend/requirements.lock` 安裝已驗證版本、產生本機密鑰、
升級資料表、建立分類與開發帳號，再確認後端及資料庫就緒。
SQLite 資料存在 `backend/demo.db`；停止、重啟後仍保留，`--sqlite` 不修改 `.env`。

前端埠號為 `5174`、後端為 `8000`。
使用啟動器印出的完整前端網址；API 互動文件在後端 `/docs`，
使用者文件在前端 `/docs/index.html`。
不要直接雙擊 HTML，請透過啟動器的 HTTP 服務使用。

```bash
python run.py --sqlite --port 5555 --api-port 8001
python run.py --front-only
```

`--front-only` 僅提供明確標示的本機模擬模式；資料存於該瀏覽器，不是後端驗收結果。
`--reset` 會刪除本機開發資料庫，發表前不要執行。

### PostgreSQL 開發模式

已安裝並啟動 Docker Desktop 時，在虛擬環境內執行：

```bash
python run.py
```

啟動器只開啟 Compose 的 `db`，沿用 PostgreSQL 16 的 `pgdata`；
不要同時啟動 Compose 的 API 與啟動器，避免占用相同埠號。

需要整組容器時，先產生本機設定，再啟動：

```bash
cd backend
python -m app.cli init-env
cd ..
docker compose up --build
```

已有 `backend/.env` 就略過 `init-env`，保留自己的設定。
容器模式不會建立公開開發帳號；請自行註冊。
Docker 建置以專案根目錄為 context，使用 `backend/Dockerfile`。
在有 HTTPS 檢查代理的環境，可透過 BuildKit 的 `pip_ca_bundle` secret 提供官方 CA bundle；
保持 TLS 驗證，不使用 `--trusted-host`。

## 第一輪展示：自然語言 → 確認 → 真實統計

1. **註冊帳號**，完成信箱驗證（本機會明示開發驗證連結；正式環境需真正收到郵件），完成或略過初始理財設定；系統會建立個人帳本。
2. 到「記一筆」，輸入 `今天午餐120元，昨天捷運40元，今天薪水30000元`。
3. 查看分成的三筆，逐項檢查日期、金額、收支與分類。畫面會標示解析來源。
4. 按「確認入帳」。只有確認後才寫入資料庫；缺金額必須先補齊。
5. 到明細搜尋或修改紀錄，再到統計查看當月收入、支出與結餘。
6. 設定餐飲預算及存款目標，說明預算使用比例和儲蓄狀態。
7. 建立家庭，邀請第二個帳號為子女，設定監管並示範唯讀查看與權限拒絕。
8. 停止後重啟，確認紀錄仍存在。

日期依臺灣時區解讀；以上例子的當月統計需要日期位於當月。
原始句子、人工修正與「規則／模型」來源分開保存，不能把規則結果列入模型評測。

### 本機開發帳號

`auth@fambudget.tw`、`ledger@fambudget.tw`、`analytics@fambudget.tw`、
`access@fambudget.tw`、`admin@fambudget.tw`，密碼皆為 `abcd1234`。
它們只用於開發；啟動器會重設其個人設定與密碼，不刪除它們的記帳資料。
正式環境不建立這些帳號，請使用自己的註冊帳號。

## 已整理的功能

| 領域 | 功能 | 說明 |
|---|---|---|
| 身分與認證 | 註冊、信箱驗證、登入、續期、登出、工作階段、個人理財設定 | 登出及撤銷工作階段會使相關權杖失效 |
| 記帳 | 自然語言解析、人工確認、明細增刪改查、分類、帳本、結算 | 金額驗證、批次全成功或全不寫，結算後帳本不可再寫 |
| 財務控管 | 月／年統計、預算、存款目標、提醒、建議 | 金額由後端加總，模型只解釋數字 |
| 家庭 | 邀請、家長／子女角色、監管、通知、零用金、稽核 | 監管是唯讀；平台管理員不能讀取個人帳務 |
| 自由登入背景 | 三種預設、自訂照片、顯示方式、位置、亮度、模糊與遮罩 | 照片原檔存此裝置、不設應用檔案大小門檻，手機可選相簿／拍照 |
| 實際金額與匯率 | 獨立手動記帳、153種貨幣試算、TWD換算結果預填 | 入帳前可改實際扣款，備註保存原幣、匯率及日期 |
| 教學與發表 | 操作流程、架構解釋、中英名詞、投影片、答辯與部署 | 可離線閱讀，不虛構模型成績 |

業務 API 共 **74 支路由**，分工與契約保留在 `backend/app/ownership.py`。
另有 `/healthz`（程式存活）、`/readyz`（資料庫及分類就緒）、
`/capabilities`（可選整合設定狀態，不回傳機密）。

## 規則解析、LLM 與發表說法

- **規則解析（Rule-based parsing）**：目前無模型服務時使用的備援；依關鍵字與數字拆出欄位，必須讓人確認。
- **大型語言模型（Large Language Model / LLM）**：設定 `MODEL_BASE_URL` 後使用 OpenAI 相容模型服務；具逾時、有限重試與輸出驗證。
- **微調（Fine-tuning）**：本次未執行，沒有可宣稱的準確率。訓練及人工標註流程見 [LLM 實作規劃](docs/03-LLM實作規劃.md)。
- **信箱驗證與忘記密碼郵件**：正式發信需 Brevo 金鑰、已驗證寄件信箱與自己的公開前端網址。正式環境未驗證不可登入；本機展示連結會明示沒有寄出郵件。

若課程要求實際微調，請依手冊補齊人工標註資料、留出集、訓練與對照實驗，
再把結果接回系統。資訊系統完整運作與模型訓練成果是不同驗收項目。

## 測試與部署

```bash
cd backend
python -m pytest -q
python -m app.ownership
```

測試包含資料模型、權限反向檢查、交易與統計、前後端契約、文件範例，以及登出／金額／批次原子性的回歸。
SQLite 的自動測試與 PostgreSQL 的實際瀏覽器展示結果分別記錄於 [VALIDATION](docs/VALIDATION.md)。

`render.yaml` 採 **同源前後端服務 + PostgreSQL**，不連到其他人的站台。
它是部署設定，尚未替你建立公開站台。
請在自己的 Render 帳號建立 Blueprint；資料庫方案、保存期限與費用依平台當時規則確認。
密鑰與郵件／模型金鑰只填平台的 Environment 設定，不加入 Git。

## 專案結構與來源

```text
frontend/          靜態介面、主題與中文教學
backend/app/       FastAPI、資料模型、路由、守衛、服務
backend/alembic/   資料庫遷移
backend/tests/     業務與前後端驗證
docs/              契約、模型規劃、發表手冊與部署指南
run.py             一鍵啟動與就緒檢查
render.yaml        Render 部署設定
docker-compose.yml PostgreSQL 與容器啟動
SOURCE.md          原始專案來源及本次修改範圍
```

信箱、背景與匯率的操作、翻譯及限制詳見 [新功能手冊](docs/08-信箱背景手動記帳與匯率.md)。

本次依附件指定的公開專案補齊原始碼並完善；來源版本與新增貢獻見 [SOURCE.md](SOURCE.md)。
