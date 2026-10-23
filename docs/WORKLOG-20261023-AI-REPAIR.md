# v178：最新實機合併／漏筆失敗的修復

接續 `recovery/household-20261017`，v177 來源
`510784ac9e490c91b71c2ce9597e8d17f326e015`、接續文件
`4694b3b73f29851bc0c637e1425c7532bd091442`。最新實際部署與來源識別碼以
PRODUCTION-ACCEPTANCE.md 為準；未記錄 live 前不可稱本版已上線。

## 實際失敗證據

使用者輸入「今天早餐65元，午餐120元。」；截圖中的 Qwen 回覆只有一列，sourceText 與 merchantText 均為整句，amountText 為「65元」、dateText 空字串、classification 為支出未分類。舊程式將 amount 轉成 null、日期留空，來源規則只補 FOOD，卻顯示已完成推論。此例未通過，不能視為記帳草稿成功。

原觀察為 Qwen2.5-0.5B-Instruct-q4f16_1-MLC，compact-v1，267 prompt／100 completion tokens，一次推論；loadMs 0、requestMs 52301、totalMs 52300、firstTokenMs 43903、decodeMs 8394、cleanupMs 0。畫面另有先前模型啟動 2.78 秒。這些數值是使用者這次裝置觀察，不得改寫成新版速度或任何整體準確率。

## 修正後行為

- 單一完整金額原文可含明確幣別前綴／單位，仍需逐字存在原文，並檢查完整數字邊界。65元可轉成65，不能從165元取65，不能把日期、發票、電話、負數、找零等當成新交易。
- 補上來源覆蓋檢查。模型合併多交易或漏筆時，只有原文明確的金額、單位、方向與單純子句才可來源恢復；模型至少要有一筆有效來源對齊候選，空白／拒絕／全虛構輸出不會被替換成假模型結果。裸數字、中文金額、近似值、範圍、算式、價格／菜單或語義不明的來源改列未核對，不捏造數字。
- 來源核對後的早餐與午餐各用自己的片段；日期只根據明確日期詞與有效日曆解析，局部繼承遇到其他日期／未知日期詞就停止。商家若其實是交易整句，清空並提示核對。
- 小計、稅、總計、付現、找零及同額重述不可擅自補成多筆；第三人、否定、未發生、假設、預算、退款／借貸等情況維持保守人工核對。混合／歧義幣別不強迫改成預設幣。
- 原 rawModelOutput、modelDraft、來源核對後 draft 分開。sourceRecovery 顯示恢復筆數、合併原列與來源位置；新增列 modelRowIndex 為 null，規則補正用獨立 draftIndex，不借用另一筆模型原判斷。模型評分不以補回後結果冒充成功。
- coverage 的 complete 只代表目前支援的來源候選與必要欄位皆已核對，並非保證所有語意正確。partial／unknown、金額／日期／分類等缺欄位明確標示；助理不能確認不完整欄位，人工修改後狀態同步更新。公開試用始終沒有入帳按鈕，所有草稿都須人工核對。
- 模型原始回覆在來源輔助後仍獨立可看；不再要求使用者找 JSON 來證明同一個已取得的失敗。

## 延遲：已修改的部分與尚不能宣稱的部分

仍是同一免費小型模型與 WebLLM 0.2.86，不更換大權重、不新增 API key 或付費推論。compact-v1 的幣別 grammar 由整份 ISO enum 改固定三個大寫字母 pattern；語義層仍檢查合法貨幣與來源。baseline 保留原 enum。沒有依每筆文字縮小幣別選項，避免強迫選錯幣或頻繁更換 schema。另明設中性 repetition／presence／frequency penalty，要求單行緊湊 JSON；若原設定本已中性，不能宣稱因此提速，降低 max_tokens 也不能加速本已自然停止的一百 tokens。

每 pass 保留 WebLLM 真正回傳的有限數值：runtime e2e／TTFT、grammar 初始化／每 token grammar 時間、prefill／decode TPS、每 output token 時間。秒轉毫秒，未知值不捏造，不匯出逐 token 陣列或私人內容，不把不同 pass 的速率相加。controller 錯誤診斷同樣使用白名單。

官方 0.2.86 實作確認 resetChat 清 KV 但保留 grammar matcher／compiler，相同 schema 可重用，不能聲稱每次都重新編譯。首次 structured request 仍會延後初始化完整 token table／grammar；load 結束前已等待 WebGPU pipelines。warm／loadMs0 不代表 grammar 已暖身，43.9秒不能單憑截圖歸因為 shader、網路或 GPU。runtime TTFT 與 grammar 時間可能重疊，不可相減冒充純 GPU prefill。

依據：[官方0.2.86實作](https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js)、[usage／request型別](https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/openai_api_protocols/chat_completion.d.ts)。本環境未執行新的 Qwen 推論，沒有新版實測提速或準確率百分比。

## 已通過檢查

相關前端 148 項通過，零跳過，包含真正 Chromium 與最新合併回覆經實際 worker／controller／HTML／翻譯的重播。引擎契約69項包含完整數字邊界、同額多筆、後置歧義、第三人／預算、小計找零、日期識別碼、重述幣別、有限 runtime 診斷與隱私。這些是假 runtime／記錄重播，並非新的模型推論。

實際 XGrammar 0.1.27 WASM 編譯與24項 grammar 檢查全部通過，含新 ISO pattern、舊 baseline registry、單位引用、空值與額外欄位。使用合成 tokenizer，未下載模型權重，不能將本機 grammar 編譯耗時當使用者首次推論速度。六語1571個鍵對齊。完整隔離後端1070項通過；精確CI／上線證據會在最後補記。

## 正式備份準備與剩餘阻擋

已取得並核對外部主機名稱；使用者提供的字串含密碼，不重複展示或放入 Git。正式設定由先前已授權的服務 API 私下準備，主機與資料庫名稱已核對，維持 TLS verify-full。該憑證後續需協調更換並同步網站設定，不能宣稱已重設或未確認就讓網站失去連線。

後續展開「進階」的截圖已確認：Tailscale 未設定、TCP destinations None，並明載必須有支援 TCP 的 VPN 才能新增。重新檢查 runtime 1864，VPN 仍 false、TCP grant 仍空。另依平台 VPN 文件，TCP 解析結果僅支援 RFC1918／CGNAT 私人地址；不能再建議只加入公開 Render External 主機或只設定 Tailscale 即可完成。HTTP 網域不授予 PostgreSQL TCP 存取，亦不得繞過平台代理。

可評估由使用者自有電腦的正常網路執行備份與隔離還原。現有工具依賴 POSIX 權限／os.getuid，不能宣稱原生 Windows 可直接執行；需要先確認 Windows／macOS 及本機必要工具，再準備相應流程。尚無跨平台一鍵包，正式備份仍未完成；未新增 VPN、未接觸正式資料庫、未變更正式網站。

使用者已確認 Windows，已新增 `tools/windows-backup`：PowerShell 本機 Docker Linux context 預檢、隱藏 URL 輸入、stdin 傳送、獨立 Linux 私人 volume、固定來源目的地與 verify-full、唯讀快照加密及全新容器內 loopback TLS 隔離還原。來源網址不進 argv、Docker inspect 環境、Git、檔案或錯誤輸出。Windows 密文／金鑰目錄分開，NTFS SID ACL 僅目前使用者與 SYSTEM，匯出逐檔及金鑰 SHA256 核對；安全錯誤階段保留，不用匯出失敗蓋住真正連線失敗。僅複製三個程式檔到建置暫存，不送整個儲存庫或 .env。

固定官方 PostgreSQL 18.6 bookworm 多架構 digest 的映像實際建置成功；真正合成本機來源→備份加密→另一個全新 TLS 資料庫還原通過：2表、5列、2個有效PNG（138bytes），資料列與照片雜湊一致，來源未改變，明文演練庫與暫存dump已清除。原生 PowerShell 7.4.7 Linux 語法／引數／錯誤報告27項通過，Windows額外17項原生引數／NTFS ACL／路徑防護由新CI執行，不能在結果出現前算通過。原工具與runner18項聚焦測試通過。CI另組合獨立工具下載包，核心備份程式不複製進Git造成版本分歧。

中止時可能留下明文暫存，保留的volume必須保持私人、不可整個分享／上傳。此工具尚不含Drive異地上傳；Windows Docker Desktop真實執行、正式資料連線／備份／隔離還原、異地上下載仍待使用者執行驗收。所有新測試只用合成資料；未接觸正式資料庫，正式網站仍是v178。

工具來源已提交 `78f3a4b38b41d45b446209223896cbf2983d8d8f`；本機後端1080項通過。GitHub workflow `39961984162` 的 checks／browser／windows-backup 三個job與workflow皆 completed/success；真正Windows PowerShell 5.1.26100.33648 的44項檢查全部通過，沒有Windows項目跳過。下載包artifact `12504733222`（22365bytes）已下載核對7個檔案、所有package SHA256及與來源的換行正規化一致；ZIP SHA256 `2cdf419334aaa89d44db0648da2946b52f1af64f2f57cb3b1a9517155312124b`。完整source bundle已驗證可讀。原故障環境保留；下一步是在使用者Windows Docker Desktop實際操作，不能將CI或合成往返宣稱為正式備份完成。

使用者後續已提供真正 Windows 執行成功畫面，run `20261023T135547Z-68c638aced66`。畫面明載正式來源資料庫已加密備份，隔離還原後資料列／照片雜湊一致，Windows匯出檔案雜湊亦已核對；統計為33表、37列、3個照片資料項目。密文與復原金鑰分別保存在不同Windows目錄，本次private volume保留，畫面已到「Press any key to continue」。網址只有星號，未顯示來源密碼或金鑰內容。

這筆狀態記為「使用者實機畫面回報通過」，不是雲端執行環境已直接連線，也不是已收到產物後的獨立密文／報告核對。截至這筆紀錄，尚未收到本次Windows備份檔、金鑰與verification.json；私人Drive異地上傳、下載回驗及獨立核對仍未完成。不得將先前2表／5列的合成測試當成本次33表正式資料，也不得預填異地保存完成。安全觀察紀錄另存 `checkpoints/20261023-windows-backup/user-device-observation.json`，未複製任何憑證。

沿用既有授權的私人Google Drive備份／金鑰母資料夾，各新增本次run專用子資料夾，父與子資料夾權限回讀均只有使用者owner、shared=false。未變更既有分享或讀取舊金鑰。新資料夾連結只留私人接續紀錄，未放入Git。需由使用者將Windows的密文／manifest／verification.json與獨立backup.key分別上傳，再讀回核對與做正式產物隔離還原；目前未上傳本次任何正式資料。

較早的雲端 runtime1789 的 HTTP 限制已生效，TCP domains／IP ranges 仍空；該雲端執行環境未連線正式資料庫。變更需平台環境設定流程與使用者審核，已詢問面板是否支援 TCP，不能把 HTTP「額外允許的網域」當成 PostgreSQL TCP 權限，也不繞過代理或政策。後續Windows使用者自有電腦的成功回報與這項雲端限制分開記錄。

官方 PostgreSQL 18.6 客戶端與全新、僅 loopback、高位 port、verify-full TLS 的隔離環境已備妥。未改動原故障容器或資料。已用原備份工具做本機合成來源→真正 custom dump→加密→另一個空資料庫還原：2表、5列、2個PNG BLOB（152 bytes），所有列／照片雜湊及 Decimal／日期／Unicode／JSON 等值相同。這是工具演練，不是正式備份，沒有上傳 Drive。

備份工具新增受限的 hostaddr 支援，供**經平台批准**的 loopback TCP 轉送使用：僅127.0.0.1／::1，且唯一 sslmode=verify-full；原主機仍用於 TLS 與來源識別，並映射給 pg_dump 的 PGHOSTADDR。不自行建立轉送或授予網路權限。弱 TLS、任意遠端地址、重複參數均拒絕；相關8項備份測試通過。新增參數另經真實本機 TLS／pg_dump 驗證，原主機名驗證保留，錯誤主機名配相同 loopback 地址確實被憑證驗證拒絕；來源識別不變，預留正式還原資料庫仍空。

原先的雲端路線需在取得正式連線權限後，使用支援的轉送保留原 TLS 主機與來源身份、確認 source major 可由 client 支援，再作正式唯讀一致快照、加密、隔離還原與完整雜湊核對。現在已改由使用者Windows本機執行，畫面回報正式來源備份及隔離還原通過；下一步沿用已授權的私人 Google Drive，備份與金鑰分開、下載回驗並獨立核對產物。異地及獨立驗證完成前，不以 GitHub、歷史 SQLite 或合成本機演練冒充。


## 保存與部署

來源 `f2247353938c3b34ed6a85c0a3113a9fdce5f27c` 的21個變動遠端blob全部驗證，完整歷史bundle已保存並驗證。GitHub workflow [39911481995](https://github.com/ChunWei-0801/-/actions/runs/39911481995) 及 checks／browser 兩job均 completed/success。完整隔離後端1070項、相關前端148項（零跳過）與24項真實WASM格式檢查通過。

Render `dep-dbdftcbrjlhs73d5b3ng` 已於 2026-10-23 14:30:26（臺灣時間）回報live，來源相同，資源版本178，免費方案、自動部署關閉。先開 `https://fambudget-recovery-20261017.onrender.com/ai-test.html?v=178`，啟動後用原本早餐／午餐句子產生草稿，檢查65與120兩筆及來源核對提示。可以回報筆數／金額與耗時，不必再貼原始JSON。新模型實機品質／耗時仍待確認；正式來源備份與隔離還原已有上述使用者Windows成功畫面，產物獨立核對及異地上下載驗證仍待完成，不能預填成功。
