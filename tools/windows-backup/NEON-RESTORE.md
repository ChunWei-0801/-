# Windows：還原加密備份到全新的空 Neon PostgreSQL18

用途是先建立可核對的目標副本，不會修改Render網站設定或原資料庫，也不表示網站搬家已完成。使用者已選擇Neon Free、AWS Oregon、PostgreSQL18；後續仍受免費用量限制。

## 下載及準備

[下載已通過Windows檢查的Neon還原工具ZIP](https://github.com/ChunWei-0801/-/actions/runs/40083147653/artifacts/12555843339)，需登入有儲存庫存取權的GitHub帳號，下載保留至2026-11-23。來源commit為`ec388cbf0f6368d7b39bab37041de84f92b4c712`，CI40083147653的checks、browser、windows-backup均成功。完整解壓縮到新資料夾，使用其中的Start-Neon-Restore.cmd；不要只抽出一個啟動檔與舊版helper混用。這個包包含Start-Neon-Restore.cmd、PowerShell啟動器、共用helper、Python runner、備份核心及Dockerfile；保留同一資料夾所有檔案。也可使用完整儲存庫的tools/windows-backup資料夾。

需要Windows10/11、Windows PowerShell5.1及本機Docker Desktop Linux containers，沿用既有備份工具的環境。來源備份和獨立金鑰使用先前工具建立的私人ACL資料夾；不要移動到公開分享資料夾。工具不要求管理員、不改Windows執行原則、不切換Docker context、不建立主機port、不掛載整個個人資料夾。

本次已由使用者回報最新來源備份35張表、41筆資料、3張照片；該回報不等於已還原Neon或完成異地驗證。請選這次最新備份，舊副本照常保留。工具驗證HMAC及密文SHA256、來源識別、24小時內時間戳、目前含行事曆的資料表、來源與目標不同，以及目標PostgreSQL18且為空，之後才還原。

## 在Neon取得私人連線網址

1. 到fambudget專案、production分支，點 **Connect**。
2. 選目前資料庫與角色，關閉 **Connection pooling**，取得直接連線。主機名稱不能含`-pooler`。
3. 選Connection string／PostgreSQL URL，複製以`postgresql://`或`postgres://`開頭的網址。不要複製`psql '...'`命令。
4. 此網址只貼進本機工具的隱藏輸入欄位，不貼聊天、Git或截圖。工具會強制TLS主機驗證及channel binding；不接受hostaddr、service或options等轉送／路由選項。

## 執行

1. 開啟Docker Desktop，等待引擎啟動。
2. 按兩下 **Start-Neon-Restore.cmd**。
3. 輸入這次加密備份資料夾完整路徑，例如`C:\Users\你的帳號\FamBudgetBackups\本次時間及識別碼`。
4. 輸入對應獨立金鑰檔完整路徑，例如`C:\Users\你的帳號\FamBudgetRecoveryKeys\同一次識別碼\backup.key`。路徑可以有空白與中文，不用改名或複製金鑰內容。
5. 等待工具準備Docker映像，再將Neon直接連線網址貼到隱藏欄位，按Enter。
6. 等待「Neon還原與雜湊核對通過」；回報資料表／資料列／照片數。本次預期35／41／3，若不同需依實際備份及驗證報告核對，不能只看數字就宣布成功。

安全報告在`%USERPROFILE%\FamBudgetMigrationReports\本次識別碼\verification.json`。它只含固定階段／代碼、版本、總數與密文雜湊，不含網址、密碼、資料列或照片內容。只有runner成功、資料與照片雜湊一致、金鑰副本及明文清理通過、報告複製後SHA256一致才顯示成功。原Windows備份與原金鑰不會被修改。

## 若失敗

只回報畫面的階段與代碼，保留原備份、金鑰、Neon資料庫及本次Docker volume。常見代碼：

- TARGET_POOLER_UNSUPPORTED：改在Neon關閉Connection pooling，取直接連線。
- BACKUP_TOO_OLD／BACKUP_SCHEMA_UNSUPPORTED：先用Start-Backup.cmd重新備份目前Render。
- BACKUP_INVALID／SOURCE_IDENTITY_MISMATCH：備份、密文或金鑰不匹配，或不屬於已確認來源；停止並核對原始檔。
- TARGET_NOT_EMPTY：目標已有資料；本工具不會清空、覆寫或重複灌入。先保留目標並核對。
- TARGET_VERSION_UNSUPPORTED：目標須為PostgreSQL18。
- OPERATION_FAILED：可能是連線、權限或還原失敗，原始伺服器錯誤可能含秘密，因此不直接印出。

部分失敗發生在完整空資料庫還原已提交但驗證尚未完成；不能假設失敗表示目標仍為空。不要自行刪表或對同一目標反覆還原。

本次專用容器會停止，私人volume保留；正常流程會移除複製到容器的金鑰，強制中斷仍可能留下私人明文暫存。保持volume私人，不上傳整個volume。工具不會動其他容器或原故障環境。

## 網站切換仍是下一階段

本工具不會改Render的DATABASE_URL、部署、停用來源或刪庫。切換前必須先確認來源自備份後有無新資料，安排停止寫入及最後一致快照／核對，檢查登入、帳務、活動權限、照片、行事曆及回退方式；必要時用另一個全新空目標承接最後快照。免費額度與DB定期喚醒／健康檢查也需處理。不能拿35／41／3這份舊快照直接覆蓋後來新增的資料。
