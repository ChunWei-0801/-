# 技術選型與 API 目錄

家庭記帳與財務控管系統｜四人 × 一個月

---

# 一、選型的三個前提

在談用什麼工具之前，先把限制寫清楚 —— 所有選擇都是從這三條推出來的：

| 限制 | 影響 |
|---|---|
| **只有一個月** | 不能有學習曲線陡的東西。每個新框架都要換算成「幾天學會」 |
| **四人中三人沒有專案經驗** | 工具要好上手、錯誤訊息要看得懂、出問題查得到中文資料 |
| **冠文有 FastAPI / Docker / Render 實戰經驗** | 後端主幹沿用他熟的，不要為了「更好」而換 |
| **沒有 GPU** | 在 Colab 免費 T4 上微調小模型，量化之後 CPU 就跑得動 |

**選型原則：能不加的就不加。** 每多一個相依，就多一個可能在最後一週爆炸的點。

---

# 二、工具清單

## 2-1　前端

| 工具 | 版本 | 用途 | 為什麼選它 |
|---|---|---|---|
| **原生 HTML / CSS / JS** | — | 整個前端 | 見下方說明 |
| **Huninn（粉圓體）** | Google Fonts | 全站中文字體 | 系統與手冊使用同一套字體；程式碼使用等寬字 |
| **Canvas API** | 瀏覽器內建 | 星空背景 | 無相依，四十行搞定 |
| **localStorage** | 瀏覽器內建 | 示範資料、登入背景選項 | 明確區分瀏覽器示範模式與真實後端 |
| **IndexedDB** | 瀏覽器內建 | 自訂登入背景照片 | 以 Blob 保存原始檔案，選項與圖片留在目前瀏覽器 |

### 為什麼不用 React / Vue

**這是一個要辯護的決定，不是省事。**

| 用 React 的好處 | 對本專案的實際影響 |
|---|---|
| 元件化、狀態管理 | 目前二十個畫面已經寫完，重寫是純成本 |
| 生態系豐富 | 我們沒有要用第三方 UI 套件 |
| 履歷加分 | 冠文已有 React 經驗，其他三人沒有 |

| 用原生的代價 | 實際狀況 |
|---|---|
| 沒有元件複用 | 二十個畫面規模還撐得住，函式化就夠 |
| 手寫 DOM 操作 | 已經封裝在 `app.js` 的 render 函式裡 |
| 沒有型別檢查 | 用 `js/api.js` 這一層集中管住資料形狀 |

**決定：維持原生。** 理由是時間 —— 三個沒有專案經驗的人要同時學 React、學 Vite、學 hooks，
再加上後端與模型，一個月做不完。**這個取捨要寫進報告，講成有意識的決定而不是能力不足。**

> 如果之後有時間，值得升級的是**打包**（Vite）而不是框架，
> 因為那只影響建置流程，不需要重寫畫面。

## 2-2　後端

| 工具 | 版本 | 用途 | 為什麼選它 |
|---|---|---|---|
| **FastAPI** | 0.115+ | Web 框架 | 冠文有實戰。自動產生 OpenAPI 文件，前後端對接時省掉很多口頭溝通 |
| **Uvicorn** | 0.34+ | ASGI 伺服器 | FastAPI 的標準搭配 |
| **Pydantic** | v2 | 請求／回應驗證 | **強制結構化輸出的關鍵**，LLM 回傳也用它驗 |
| **pydantic-settings** | 2.6+ | 環境變數管理 | 設定集中，不散落在各處 |
| **SQLAlchemy** | 2.0 | ORM | 2.0 的型別標註對新手比較友善 |
| **Alembic** | 1.14+ | 資料庫遷移 | 25 張表一定會改，沒有遷移工具會很痛苦 |
| **psycopg** | 3.2+ | PostgreSQL 驅動 | `[binary]` 版有預編譯輪檔，不用編譯 |
| **PyJWT** | 2.10+ | JWT 簽發驗證 | 比 python-jose 維護更活躍 |
| **passlib[bcrypt]** | 1.7+ | 密碼雜湊 | **絕不自己實作密碼雜湊** |
| **python-multipart** | 0.0.20+ | 表單登入 | OAuth2 密碼流程需要 |

### 為什麼不用 Django

Django 內建 admin 與 auth，聽起來很划算。但：

- 冠文的實戰經驗在 FastAPI，換框架等於放棄既有優勢
- Django 的 ORM 與 FastAPI 的 Pydantic 是兩套思維，混用會亂
- 本專案的 API 是給自己的前端用，不需要 Django 的完整後台

### Redis 要不要用

**建議第一版不用。** 原型設計裡列了 Redis，但實際盤點後：

| 原本想用 Redis 做的 | 沒有 Redis 的替代 |
|---|---|
| session 儲存 | `sessions` 資料表就夠，四人家庭規模不會有效能問題 |
| 快取統計結果 | 一個家庭幾百筆交易，直接查資料庫毫秒級 |
| LLM 回應快取 | 存進 `nlp_parses` 表反而更有用（同時是訓練資料） |

**多一個服務就多一個要維護、要部署、要除錯的東西。** 有時間再加。

## 2-3　LLM

| 工具 | 用途 | 說明 |
|---|---|---|
| **Qwen2.5-1.5B-Instruct** | 一句話記帳的解析、財務建議的敘述 | 自己微調的開源權重。選型與理由在專題手冊的「模型」那一頁 |
| **QLoRA ＋ Colab 免費 T4** | 微調 | 沒有 GPU，只能靠免費雲端；1.5B 一輪約一小時 |
| **GGUF ＋ llama.cpp（Hugging Face Space）** | 上線提供服務 | 量化成 q4 約 1 GB，CPU 跑得動；提供 OpenAI 相容的 `/v1/chat/completions` |
| **httpx** | 後端呼叫模型 | `services/llm/client.py` 已經寫好：逾時、重試、剝掉 ```json 包裝 |
| **Pydantic** | 約束模型輸出格式 | 模型回傳的 JSON 一定要過 Pydantic 驗證才採用 |

後端只認一個網址（`MODEL_BASE_URL`），**換模型不用改程式**：few-shot 基準線、第一輪、第二輪微調都是換網址。
商業 API（OpenAI 相容的）接得上同一支 client，可以拿來當對照組；課程重點是自己操作 LLM，**上線的模型用自己微調的**。

### 模型還沒好的時候

| 狀況 | 系統怎麼辦 |
|---|---|
| `MODEL_BASE_URL` 沒填、或模型服務叫不動 | 解析與建議的路由回 **503**；前端用規則頂著（解析：金額、中文數字、分類關鍵字；建議：用算好的數字寫成句子），畫面照常能用 |
| few-shot 基準線 | 同一顆 1.5B 不微調，只給範例。這就是對照表的第一列 |
| 微調後 | 換 `MODEL_BASE_URL`，其他程式碼一行都不用改 |

> **評測不能省。** 要交出「零樣本 vs few-shot vs 微調」的對照數字，那是本專題的量化成果。
> 評測工具在 `services/evaluation.py`（完全正確率、分類 Macro-F1）。

## 2-4　開發與部署

| 工具 | 用途 |
|---|---|
| **Docker + Docker Compose** | 本機一鍵起 db + api + web，`docker compose up` |
| **PostgreSQL 16** | 資料庫。本機跑容器、線上用 Render 免費方案 |
| **Git / GitHub** | 版本控制。帳號 cbes502034 |
| **Render** | 部署。前端靜態站台走 CDN、後端 Python 服務、免費 PostgreSQL |
| **pytest** | 後端測試 |
| **httpx** | 測試用的 HTTP client（FastAPI TestClient 底層） |

---

# 三、專案目錄結構

```
final_project/
├── run.py                       ★ 一鍵啟動：裝套件、建 .env、建表、同時起前後端
├── frontend/                    前端（純靜態，可直接發布）
│   ├── index.html               <meta name="api-base"> 留空 = mock、填網址 = 真後端
│   ├── css/
│   │   ├── tokens.css           設計權杖：顏色、圓角、字體（預設的米白）
│   │   ├── app.css              元件與畫面，只准用變數
│   │   └── themes.css           另外七套主題
│   ├── js/
│   │   ├── data.js              資料表草案（schema）與固定清單（分類、主題、角色）。沒有假資料
│   │   ├── api.js          ★    唯一的資料入口：mock／http 兩個轉接器 ＋ 前端代勞 ＋ 錯誤指出是哪一支
│   │   ├── app.js               路由、畫面繪製、互動
│   │   ├── notify.js            通知鈴鐺（20 秒輪詢）
│   └── docs/                    專題手冊（站上的 /docs/）
│
├── backend/
│   ├── app/
│   │   ├── main.py              入口：CORS、錯誤處理、掛上 routers/ 的每一組
│   │   ├── guards.py        ★   路由守衛：@login_required、@parent_required、own()、in_group()…
│   │   ├── cli.py               python -m app.cli：init-env、check-config、init-db、make-admin
│   │   ├── ownership.py         分工的單一事實來源（誰負責哪支路由、哪些檔案）
│   │   ├── catalog.py           固定清單（角色、權限表、理財選項、系統分類…），正本是 data.js
│   │   ├── toolkit/         ★   寫好的工具：config、db、crud（增刪改查）、tokens、passwords、scope、family…
│   │   ├── models/              25 張表（SQLAlchemy），欄位跟 data.js 的 schema 逐欄對齊
│   │   ├── schemas/             請求主體（Pydantic），欄位名字跟前端送的一樣
│   │   ├── routers/             89 支路由，一個領域一個資料夾；以測試與 /docs 驗證
│   │   │   ├── auth/            認證（auth.py、admin.py；services/email_verification.py 處理寄信）　← 每個資料夾裡都有 README.md
│   │   │   ├── ledger/          記帳（transactions、nlp、categories、groups）
│   │   │   ├── analytics/       數字（stats、budgets、alerts、advices、exchange）
│   │   │   ├── access/          家庭（family、notifications）
│   │   │   └── _stub.py         共用：@stub 與 not_ready()
│   │   └── services/
│   │       ├── llm/client.py    模型呼叫層（已完成）
│   │       ├── llm/parse.py     記帳解析（記帳）
│   │       ├── llm/advice.py    財務建議（數字）
│   │       ├── analytics.py     所有加總（數字）
│   │       ├── permission.py    可見範圍（家庭）
│   │       └── evaluation.py    模型評測指標
│   ├── alembic/                 資料庫遷移（包含信箱驗證欄位與一次性 token 資料表）
│   ├── tests/                   pytest（routes/：每一支路由的驗收測試；fixtures/：假後端）
│   ├── tools/                   sync_schema.py、sync_catalog_counts.py：同步資料表與文件摘要數量
│   ├── requirements.txt
│   ├── Dockerfile               啟動前先 alembic upgrade head
│   └── .env.example             設定範本，依成員分段
│
├── docs/                        規格文件
├── docker-compose.yml           本機的 PostgreSQL（db）；run.py 會自己開
├── render.yaml                  部署設定
└── README.md
```

**分層原則：`routers` 只做接收與回傳，規則放 `toolkit/`、加總與模型放 `services/`。**
這樣測試時可以直接測函式，不必每次都起一個 HTTP 請求。

---

# 四、API 目錄清單

共 **89 條路由**（另有 `/healthz`、`/docs` 兩支系統路由）。標示說明：

- **權限**：`公開` / `登入` / `本人` / `家長` / `監管者` / `建立者` / `平台管理員`
- ⚠️ `家長` 是**家庭**治理權限；`平台` 是系統管理員，只能停權與查稽核，讀不到任何財務資料。兩者完全分開。
- ★ 記號代表與 LLM 直接相關

## 4-1　身分認證 `/api/auth`

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | 認證 | 公開 | 註冊。只問名字、email、密碼，回傳 user + tokens（存款目標在註冊後的個人化設定） |
| 2 | POST | `/api/auth/login` | 認證 | 公開 | 登入。正式環境先確認信箱已驗證，再回傳 access + refresh token |
| 3 | POST | `/api/auth/refresh` | 認證 | 公開 | 用 refresh token 換新的 access token |
| 4 | POST | `/api/auth/logout` | 認證 | 登入 | 撤銷目前的 refresh token |
| 5 | POST | `/api/auth/logout-all` | 認證 | 登入 | 撤銷所有裝置的 token |
| 6 | GET | `/api/auth/me` | 認證 | 登入 | 目前使用者、家庭角色、看得到誰、被誰監管 |
| 7 | PATCH | `/api/auth/password` | 認證 | 登入 | 修改密碼，同時讓其他 session 失效。舊密碼不對回 400 |
| 74 | POST | `/api/auth/password-reset` | 認證 | 公開 | 忘記密碼：寄一次性的重設連結（Brevo）。**有沒有這個帳號都回同一句話** |
| 75 | POST | `/api/auth/password-reset/confirm` | 認證 | 公開 | 用信裡的 token 設新密碼。30 分鐘失效、只能用一次，成功後撤銷所有 sessions |
| 77 | POST | `/api/auth/email-verification/request` | 認證 | 公開 | 申請信箱驗證信。正式環境寄信；開發示範連結明示未寄信，30 分鐘有效 |
| 78 | POST | `/api/auth/email-verification/confirm` | 認證 | 公開 | 驗證一次性 token，標記信箱已驗證；重寄後舊連結失效 |
| 8 | GET | `/api/auth/me/finance` | 認證 | 本人 | 我的理財習慣（財務建議的背景） |
| 9 | PUT | `/api/auth/me/finance` | 認證 | 本人 | 改理財習慣。body: { style, goals[], habits[], note } |
| 10 | POST | `/api/auth/verify-password` | 認證 | 本人 | 重大操作前再確認一次。不發新 token；不對回 400 |
| 11 | GET | `/api/auth/sessions` | 認證 | 登入 | 列出有效的登入裝置 |
| 12 | PATCH | `/api/auth/me` | 認證 | 登入 | 修改個人資料：顯示名稱、出生年、主題；個人化設定走完送 `onboarded: true` |
| 13 | PUT | `/api/auth/me/avatar` | 認證 | 登入 | 上傳大頭貼。前端已縮到 256×256 |
| 14 | DELETE | `/api/auth/me/avatar` | 認證 | 登入 | 移除大頭貼，改回顯示文字頭像 |
| 62 | GET | `/api/admin/users` | 認證 | 平台管理員 | 帳號清單（停權用）。⚠️ 刻意不回傳任何金額 |
| 63 | POST | `/api/admin/users/{user_id}/suspend` | 認證 | 平台管理員 | 停權一個帳號。body: { reason }，理由必填 |
| 64 | DELETE | `/api/admin/users/{user_id}/suspend` | 認證 | 平台管理員 | 解除停權 |

**⚠️ 停權是關門，不是配鑰匙。**

平台管理員停得了違規帳號，但**讀不到任何一筆帳**。
一個能讀全系統消費明細的帳號，比家長越權嚴重得多——家長越權至少還在一個
看得見彼此的家庭裡，平台管理員的視角則沒有任何人看得到。
所以 `/api/admin/users` 只回身分欄位，`income`／`expense`／`savingsGoal` 一律不給；
不是前端藏起來，是後端真的不回。

另外三條界線：

- **停權不刪任何資料。** 擋登入、擋寫入，紀錄全部留著。停權是可以解除的。
- **理由必填**（少於 4 個字退回）。沒有理由的停權就是任意封鎖，被停的人也沒有東西可以申訴。
- **每一次停權與解除都要寫進 `audit_logs`。** 「誰放他回來的」跟「誰停的他」一樣重要。

權限判斷一律走 `toolkit/roles.py` 的 `require_platform()`，它的白名單只有
停權、解除停權、讀稽核三項——不要在路由裡自己寫 `if user.is_platform_admin`。


**回應範例 — `POST /api/auth/login`**

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "expiresIn": 1800,
  "user": { "id": "1", "name": "王大明", "email": "daming@wang.tw", "role": "parent",
            "familyId": "1", "avatar": "明", "avatarUrl": null,
            "onboardedAt": "2026-01-05T09:00:00+08:00", "theme": "sky", "savingsGoal": 20000 }
}
```

⚠️ ID 回字串（`crud.to_dict` 預設就轉）。每一支的完整形狀在 `02-前後端串接契約.md`。

## 4-2　家庭與權限 `/api/family`

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 46 | GET | `/api/family` | 家庭 | 登入 | 家庭資訊、成員清單、角色 |
| 47 | POST | `/api/family` | 家庭 | 登入 | 建立家庭，建立的人成為家長。已經在家庭裡就不行 |
| 76 | DELETE | `/api/family` | 家庭 | 家長 | 解散家庭。**只有唯一的家長能解散**；每個人離開、紀錄都不刪 |
| 48 | POST | `/api/family/invite` | 家庭 | 家長 | 產生邀請碼。body: { role }，只能用一次、七天過期 |
| 49 | POST | `/api/family/join` | 家庭 | 登入 | 用邀請碼加入家庭 |
| 68 | GET | `/api/family/lookup` | 家庭 | 家長 | 用完整 email 找人，準備邀請他加入家庭 |
| 69 | GET | `/api/family/invites` | 家庭 | 登入 | 我收到的邀請、我們家送出去還沒回覆的、還有效的邀請碼 |
| 70 | POST | `/api/family/invites` | 家庭 | 家長 | 用帳號邀請。body: { userId, role } |
| 71 | POST | `/api/family/invites/{invite_id}/accept` | 家庭 | 被邀請的人 | 接受邀請，加入家庭 |
| 72 | DELETE | `/api/family/invites/{invite_id}` | 家庭 | 被邀請的人／家長 | 婉拒（被邀請的人）或取消（發邀請那一家的家長） |
| 50 | PATCH | `/api/family/members/{user_id}` | 家庭 | 家長 | 改角色。子女可以設為家長；**不能把另一位家長改成子女**，只能自己改（家裡要還有別的家長） |
| 51 | DELETE | `/api/family/members/{user_id}` | 家庭 | 家長／本人 | 家長把子女移出家庭；寫 `me` 就是自己退出。不刪資料 |
| 52 | GET | `/api/guardianships` | 家庭 | 登入 | 同一個家庭的監管關係。**被監管者也看得到** |
| 53 | POST | `/api/guardianships` | 家庭 | 家長 | 開始照看一個子女。body: { wardId }，**監管人一定是自己** |
| 54 | DELETE | `/api/guardianships/{gid}` | 家庭 | 監管者／同家庭的家長 | 停止照看（設 `ended_at`，不刪除）。被照看的人自己不能解除 |
| 55 | GET | `/api/notifications` | 家庭 | 登入 | 通知清單。帶 since 只拿新的 |
| 56 | PATCH | `/api/notifications/{nid}` | 家庭 | 本人 | 把一則標記成已讀 |
| 57 | PATCH | `/api/notifications` | 家庭 | 本人 | 整批標記已讀 |
| 25 | GET | `/api/groups` | 記帳 | 登入 | 我加入的群組（帳本） |
| 26 | POST | `/api/groups` | 記帳 | 登入 | 建立一個群組，建立者自動加入 |
| 27 | PATCH | `/api/groups/{gid}` | 記帳 | 建立者 | 改名稱、顏色、備註，或復原封存（`archived: false`） |
| 28 | DELETE | `/api/groups/{gid}` | 記帳 | 建立者 | 封存這本帳；`?permanent=true` 移除已結算的活動帳本（紀錄保留） |
| 29 | POST | `/api/groups/{gid}/members` | 記帳 | 建立者 | 把家人加進這本帳 |
| 30 | DELETE | `/api/groups/{gid}/members/{user_id}` | 記帳 | 建立者 | 把某個人移出這本帳 |
| 31 | POST | `/api/groups/{gid}/settle` | 記帳 | 本人（開帳本的人） | 結算活動帳本。之後唯讀，不能再往裡面記 |
| 32 | PATCH | `/api/groups/{gid}/notify` | 記帳 | 帳本成員 | 這本帳有動靜要不要通知我。body: { notify } |
| 58 | GET | `/api/allowances` | 家庭 | 登入 | 我每月給每個被監管者多少零用金 |
| 59 | PUT | `/api/allowance` | 家庭 | 監管者 | 設定零用金。body: { wardId, amount } |
| 65 | GET | `/api/audit` | 家庭 | 平台管理員 | 稽核紀錄：誰做了什麼。⚠️ 只記動作，不記金額 |

## 4-3　記帳 `/api/transactions`

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 15 | GET | `/api/transactions` | 記帳 | 登入 | 明細。可帶 `userId` / `groupId` / `from` / `to` / `categoryId` / `kind` / `source` / `q` / `page`；不認得的參數回 422 |
| 16 | POST | `/api/transactions` | 記帳 | 登入 | 手動新增。**單筆手動模式走這支**，不經過模型，寫入的 `source` 記成 `manual` |
| 17 | PATCH | `/api/transactions/{tx_id}` | 記帳 | 本人 | 修改。只送要改的欄位；結算過的帳本裡的不能改（409） |
| 18 | DELETE | `/api/transactions/{tx_id}` | 記帳 | 本人 | 刪除一筆。結算過的帳本裡的不能刪（409） |
| 73 | DELETE | `/api/transactions` | 記帳 | 本人 | 一次刪多筆。`?ids=T1,T2`，最多 100 筆；**全部成功或全部不動** |
| 23 | GET | `/api/categories` | 記帳 | 登入 | 分類體系（系統預設 + 家庭自訂） |
| 24 | POST | `/api/categories` | 記帳 | 家長 | 新增家庭自訂分類。body: { name, kind }，1～10 字、同收支不重名 |

**查詢參數的權限行為**：不帶 `userId` 時回傳「你看得到的所有人」；
帶 `userId` 但你沒有權限看那個人 → **回 403 而不是空陣列**（空陣列會讓人以為對方沒記帳）。

## 4-4　一句話記帳 ★ `/api/nlp`

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 19 | POST | `/api/nlp/parse` | 記帳 ★ | 登入 | 單句：一句話 → 一筆。**只解析，不寫入** |
| 20 | POST | `/api/nlp/parse-batch` | 記帳 ★ | 登入 | **段落：一段話 → 切成 N 筆**。只解析，不寫入 |
| 21 | POST | `/api/nlp/confirm` | 記帳 ★ | 登入 | 單筆確認後寫入，同時記錄修正供評測。`source` 記成 `nlp`，只有經過模型的資料才走這支 |
| 22 | POST | `/api/nlp/confirm-batch` | 記帳 ★ | 登入 | 批次確認後一次寫入 N 筆 |

**段落解析比單句難的地方在「切分」**：模型要先判斷這段話裡有幾筆。
切錯（把兩筆合成一筆）比抽錯更難發現，所以**切分結果也要讓使用者確認** ——
畫面上每一列都標出它對應原句的哪一段。

缺欄位的處理：**直接標在該欄位上**（紅框 + 「必填」標記），
整列變色，補齊之前送出鈕停用。

**這兩支是整個系統的核心。** 分成兩步是刻意的 —— 模型不直接寫資料庫。

**請求 — `POST /api/nlp/parse`**

```json
{ "text": "今天午餐吃了120" }
```

**回應**

```json
{
  "raw": "今天午餐吃了120",
  "matched": false,
  "out": { "date": "2026-09-10", "amount": 120, "kind": "expense", "cat": "1",
           "merchant": "", "conf": 0.98, "catConf": 0.94 },
  "note": "「今天」已換算成實際日期"
}
```

**請求 — `POST /api/nlp/confirm-batch`**（段落版，畫面實際在用的）

```json
{ "items": [ { "span": "今天午餐吃了120", "date": "2026-09-10", "amount": 120, "kind": "expense",
               "cat": "4", "merchant": "", "note": "",
               "orig": { "by": "model", "date": "2026-09-10", "amount": 120, "kind": "expense", "cat": "1" } } ] }
```

外層是使用者確認過的值，`orig` 是解析當下的原始結果。**兩邊不一樣的欄位存進 `nlp_parses.user_corrected`，
成為下一輪的訓練資料。這是本系統的資料飛輪。**（`orig.by` 是 `rules` 的是前端規則頂著的，不算模型的成績。）

## 4-5　統計與預算

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 33 | GET | `/api/summary` | 數字 | 登入 | 摘要。`scope=me\|family`、`period=2026-09`、`groupId`。統計頁唯一的來源 |
| 35 | GET | `/api/budgets` | 數字 | 登入 | 預算與使用率 |
| 36 | PUT | `/api/budgets` | 數字 | 本人 | 設定自己的分類預算。body: { cat, limit, period }，`limit: 0` = 拿掉 |
| 38 | PUT | `/api/savings-goal` | 數字 | 本人 | **設定每月存款目標**（註冊後的個人化設定也走這支）。⚠️ 只有本人能設，監管者不能代設 |
| 39 | GET | `/api/savings-goals` | 數字 | 登入 | 我的每月存款目標：不分群組的整體目標 ＋ 每個群組各自的 |
| 40 | GET | `/api/alerts` | 數字 | 登入 | 我設定的階段性提醒門檻 |
| 41 | POST | `/api/alerts` | 數字 | 本人 | 新增一個門檻（百分比 1~200） |
| 42 | PATCH | `/api/alerts/{aid}` | 數字 | 本人 | 改百分比、或暫時關掉 |
| 43 | DELETE | `/api/alerts/{aid}` | 數字 | 本人 | 刪掉一個門檻 |

**存款目標的計算**

```
可支配上限 = 本月收入 − 每月存款目標
支出 / 可支配上限 = 使用率

使用率 < 80%   → 達標中
80% ~ 100%     → 接近上限
> 100%         → 存不到目標，跳警告並算出短少多少
```

建好帳號之後的「個人化設定」第一步就會問「每月想存多少」（可以跳過，之後在個人資料改）。目標改動**保留歷史不覆蓋**
（`savings_goals` 帶 `period_key`），否則回頭看會不知道當時的目標是多少。

## 4-5-1　國際匯率 `/api/exchange`

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 79 | GET | `/api/exchange/rates` | 數字 | 公開 | `base=USD` 查國際參考匯率、來源與資料日期 |
| 80 | POST | `/api/exchange/convert` | 數字 | 公開 | `{ amount, fromCurrency, toCurrency }` 換算；Decimal 金額與匯率以字串回傳 |

Exchange rate（匯率）表示 **1 單位來源貨幣可換多少目標貨幣**。例如說明用的 `100 × 32 = 3200`，不是目前行情。
後端接公開參考來源，保留 `provider`（來源）、`updatedAt`（資料日期／時間）、`fetchedAt`（取得時間）、
`updatePrecision`（每日／秒級）與 `stale`（是否使用尚可用的舊快取）。每日資料要顯示日期，不能標成即時報價。
提供者無法連線且沒有有效快取時回 503，示範模式不編造匯率。

換算頁可直接帶入手動記帳：**TWD 結果**帶入金額，原幣金額、匯率與資料日期寫入備註；
使用者確認分類、日期與實際扣款再送出。帳本統計目前仍以 TWD 為單位，其他幣別可試算；
多幣別帳本、銀行買賣價、手續費與交易當日歷史匯率是後續範圍。

## 4-6　財務建議 ★ `/api/advices`

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 44 | GET | `/api/advices` | 數字 | 登入 | 建議清單。`scope`、`period` |
| 45 | POST | `/api/advices/generate` | 數字 ★ | 登入（全家限家長） | 產生這個月的建議。body: { scope }。**後端先算好數字再餵給模型** |

**產生流程（順序不能顛倒）**

```
1. analytics service 從資料庫算出所有數字
        ↓
2. 把「算好的數字」組成 prompt 的一部分
        ↓
3. 呼叫模型，要求它只做敘述與歸納
        ↓
4. Pydantic 驗證輸出格式
        ↓
5. 把數字存進 advices.basis_json（給使用者驗算用）
```

**模型不做任何算術。** 財務數字算錯會讓使用者做出錯誤決定，而模型本來就不擅長算術。

## 4-7　系統

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 66 | GET | `/healthz` | 系統 | 公開 | 健康檢查（Render 用） |
| 67 | GET | `/docs` | 系統 | 公開 | FastAPI 自動產生的 OpenAPI 文件 |

---

# 五、前端如何接上

前端的 `frontend/js/api.js` 有兩個轉接器，**簽章完全一致**：

| 模式 | 什麼時候 | 資料在哪 |
|---|---|---|
| **mock** | `<meta name="api-base">` 留空 | 跑在瀏覽器裡的後端，規則跟契約一樣，資料存在 `localStorage`。**沒有任何假資料或範例帳號**，從註冊開始 |
| **http** | 填上後端網址 | 全部改用 `fetch` 打真後端，不會混著用 mock |

```html
<meta name="api-base" content="https://fambudget-backend.onrender.com">
```

切到 http 之後，資料與寫入走真實後端。模型暫時無法使用（503）時，前端可以用規則解析或以現有統計寫出建議，
並標記 `fallback: true`；寫入仍走後端。匯率無法取得時顯示錯誤，不以假資料替代。
其他端點的缺欄位、權限或連線問題會指明函式、路由與負責領域，方便驗收與除錯。

## 5-1　規格與驗收

路由的說明字串、Pydantic 請求結構與 `docs/02-前後端串接契約.md` 一起描述資料格式、權限與錯誤。
後端 `/docs` 是依目前程式產生的互動文件。使用 `pytest` 驗證真實實作；
`python backend/tools/sync_schema.py` 同步資料表說明，`python backend/tools/sync_catalog_counts.py` 同步摘要數量。
API 目錄編號保留歷史識別碼，不代表路由總數；總數以 `ownership.py` 為準。

---

# 六、領域

| 領域 | 資料夾 | 路由 |
|---|---|---|
| **認證** | `backend/app/routers/auth/` | 24 支 |
| **記帳** | `backend/app/routers/ledger/` | 31 支 |
| **數字** | `backend/app/routers/analytics/` | 13 支 |
| **家庭** | `backend/app/routers/access/` | 21 支 |

路由屬於哪個領域，寫在 `backend/app/ownership.py`（`python -m app.ownership` 會印出各領域的完成度）。

操作、驗收與發表流程見 [`04-發表與驗收手冊.md`](04-發表與驗收手冊.md)，部署設定見 [`05-部署指南.md`](05-部署指南.md)。

# 七、本機開發

```bash
# 一鍵起 db + api + web
docker compose up

# 前端  http://localhost:5174
# 後端  http://localhost:8000
# 文件  http://localhost:8000/docs
```

只跑前端（不需要後端也能完整操作，資料存在瀏覽器裡）：

```bash
python -m http.server 5174 --directory frontend
```

## 4-8　外觀同步、回憶照片與小天地

| # | 方法 | 路徑 | 領域 | 權限 | 用途 |
|---|---|---|---|---|---|
| 81 | GET | `/api/auth/me/appearance-image` | 認證 | 本人 | 讀取自己的同步背景照片。Private JPEG bytes; 404 尚未上傳照片。 |
| 82 | POST | `/api/auth/me/appearance-image` | 認證 | 本人 | 同步自己的背景照片。背景實際解碼、縮圖後存資料庫；回傳受保護的圖片路徑。 |
| 83 | DELETE | `/api/auth/me/appearance-image` | 認證 | 本人 | 清除自己的同步背景照片。移除帳號雲端照片，不刪除交易或其他人的背景。 |
| 84 | GET | `/api/transactions/{transaction_id}/photos` | 記帳 | 可見範圍 | 紀錄的回憶照片。照片讀取遵循交易可見範圍；修改一律限紀錄本人。 |
| 85 | POST | `/api/transactions/{transaction_id}/photos` | 記帳 | 本人 | 拍照或加入購買照片。multipart file；每筆最多4張，瀏覽版本上限20 MB；解碼並移除EXIF後持久保存。 |
| 86 | GET | `/api/transaction-photos/{photo_id}/image` | 記帳 | 可見範圍 | 查看紀錄照片。Private JPEG bytes；需登入且仍有該交易讀取權限。 |
| 87 | DELETE | `/api/transaction-photos/{photo_id}` | 記帳 | 本人 | 移除自己的紀錄照片。刪除照片不影響原交易金額；共享成員與監管者不能代刪。 |
| 88 | GET | `/api/memories` | 記帳 | 本人 | 小天地與拼圖進度。伺服器回傳拼圖、設定、待分配片數、週期額度與影像限制。 |
| 89 | PATCH | `/api/memories/settings` | 記帳 | 本人 | 設定拼圖與成就牆。只送要改的設定；片數9/16/25/36/64/100，每期可開始1至31張；不接受客戶端片數獎勵。 |
| 90 | POST | `/api/memories/puzzles` | 記帳 | 本人 | 選照片開始下一幅拼圖。multipart file；未完成目前拼圖時409，跨週/月也不能跳過；新圖受當期額度限制。 |
| 91 | GET | `/api/memories/puzzles/{game_id}/image` | 記帳 | 本人 | 拼圖及永久成就照片。Private JPEG bytes；只能讀自己的拼圖與已完成成就快照。 |
| 92 | GET | `/api/memories/achievements` | 記帳 | 本人 | 依年月查看成就牆。year/month/page查詢；以完成當時的拼圖時區歸檔年月，每頁50項。 |
| 93 | PUT | `/api/memories/wall-background` | 記帳 | 本人 | 設定成就牆背景照片。multipart file；可自由更換自己的成就牆背景，不改既有拼圖快照。 |
| 94 | DELETE | `/api/memories/wall-background` | 記帳 | 本人 | 移除成就牆背景照片。清除牆面背景，不刪除已完成成就。 |
| 95 | GET | `/api/memories/wall-background/image` | 記帳 | 本人 | 自己的成就牆背景。Private JPEG bytes；無背景時404，沒有公開圖片網址。 |

背景設定為獨立的 `#/appearance` 頁，可先預覽再套用。套用後登入與登入後頁面使用相同外觀；登入後的照片同步是帳號私有的瀏覽版本。

每筆新記帳的片數由伺服器記錄，失敗儲存不領片，修改不重複獎勵。未完成拼圖不能因跨期換照片；完成圖與完成年月永久保存。未完成拼圖使用的交易刪除後撤回該片，相同內容重建不重複發獎。
