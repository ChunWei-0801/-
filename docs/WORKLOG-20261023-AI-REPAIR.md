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

## 正式備份、異地保存與隔離還原驗證

已核對正式外部主機與資料庫；使用者先前貼出的字串含密碼，不重複展示或放入Git。憑證仍需協調更換並同步網站設定，不能宣稱已重設或未確認就讓網站失去連線。

雲端TCP限制已查明：進階設定需要VPN，且支援的TCP目的地只接受私人網路位址；HTTP網域或單獨設定Tailscale不會使公開Render資料庫可達。未繞過代理或改動政策。本次正式快照由使用者Windows正常網路取得，雲端僅處理已授權的私人Drive下載副本，未直接連正式資料庫。

Windows工具來源 `78f3a4b38b41d45b446209223896cbf2983d8d8f` 已保存。它以本機Docker Linux context、隱藏URL輸入及stdin、獨立私人volume執行唯讀快照與加密；密文與金鑰分開，Windows SID ACL及匯出SHA256核對。官方PG18.6 bookworm映像固定digest；完整本機後端1080項通過，相關備份18項、Linux PowerShell27項通過。GitHub workflow `39961984162` 的checks／browser／windows-backup均成功；真正Windows PowerShell5.1的44項檢查全數通過。下載包7檔與來源／SHA256核對，完整source bundle可讀。

使用者實機run `20261023T135547Z-68c638aced66` 先回報33表、37列、3個照片資料項，正式快照加密、本機隔離還原及匯出檔案雜湊通過。其後使用者已將密文、manifest與verification.json上傳私人備份資料夾，backup.key另放獨立私人金鑰資料夾。父／子資料夾及四個檔案權限均回讀為使用者owner-only，未公開分享；實際位置僅留私人接續紀錄。

四個正式產物皆已由Drive原檔下載並核對provider大小；密文、manifest與金鑰的SHA256均與原Windows報告吻合。metadata wrapper沒有回傳provider checksum欄位，因此不宣稱已核對該欄位；verification.json也沒有可比對的原始自我SHA256。manifest HMAC與來源識別吻合。真正用這份異地下載的正式快照，在全新 `--network none`、無公開port的PG18容器還原，所有資料表資料列與照片雜湊一致：**33表、37列、3個照片BLOB、2,983,651bytes**。原來源未被還原寫入，演練明文已清理。source與client major皆18；proof的 `productionConnected:false` 表示雲端未直接連正式來源，並非沒有正式資料備份。

快照時間為2026-10-23 21:57:07（臺灣時間），獨立隔離還原驗證完成於22:15:19。密文SHA256為 `f25037290dd42e85f0b4746a8180b9c62584d49f52c7b5e3d96f6095bd51b9b4`。安全驗收證明亦已上傳私人Drive備份資料夾、權限回讀，並下載回驗SHA256完全一致。這次正式快照的異地保存及復原驗證已完成；先前2表／5列的合成測試未拿來冒充這筆正式證據。

這是**該時間點的備份**，沒有排程自動備份；之後新增或修改的帳務、會員及照片，需要再次執行備份並做異地回驗。復原步驟與保護範圍見 [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md)。公開Git只存程式與安全統計，不存實際Drive IDs／URLs、金鑰路徑、金鑰、manifest或資料內容。原故障環境保留，正式網站仍是v178，這一階段沒有更動應用程式或部署。

## 保存與部署

來源 `f2247353938c3b34ed6a85c0a3113a9fdce5f27c` 的21個變動遠端blob全部驗證，完整歷史bundle已保存並驗證。GitHub workflow [39911481995](https://github.com/ChunWei-0801/-/actions/runs/39911481995) 及 checks／browser 兩job均 completed/success。完整隔離後端1070項、相關前端148項（零跳過）與24項真實WASM格式檢查通過。

Render `dep-dbdftcbrjlhs73d5b3ng` 已於 2026-10-23 14:30:26（臺灣時間）回報live，來源相同，資源版本178，免費方案、自動部署關閉。先開 `https://fambudget-recovery-20261017.onrender.com/ai-test.html?v=178`，啟動後用原本早餐／午餐句子產生草稿，檢查65與120兩筆及來源核對提示。可以回報筆數／金額與耗時，不必再貼原始JSON。新模型實機品質／耗時仍待確認；上述正式來源快照的私人異地保存、原檔下載核對、HMAC與獨立隔離還原均已完成，後續新增資料需另作新備份。
