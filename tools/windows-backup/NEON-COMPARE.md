# Windows：唯讀比對目前Render與已還原的Neon

這個工具檢查兩邊是否仍然一致；**不會還原、寫入、刪除、切換網站或啟用維護模式**。本文件對應準備中的Start-Neon-Compare.cmd及同版檔案，新工具的完整驗證與發布狀態以[搬移紀錄](../../docs/FREE-DATABASE-MIGRATION.md)及協作者提供的已通過檢查下載包為準。不要把舊的Neon還原下載包當成比對工具。

## 何時才執行

先等協作者確認維護版本已部署，並約定暫停操作的時段。網站所有API請求都應先進入維護模式，且舊部署／進行中操作已結束。只關閉自己的瀏覽器不足以保證來源停止寫入；其他分頁、成員與部分GET也可能改動資料。

工具會在任何資料庫查詢前，以及比對完成前，再確認固定網站的/capabilities回傳maintenance_mode=true。未開維護、回應不明或無法連線均停止，不會當成成功。這個確認不能取代維護部署及排空舊請求；勿在比對途中解除維護。

## 準備

1. 使用Windows10/11、Windows PowerShell5.1和本機Docker Desktop的Linux containers。開啟Docker Desktop，等待顯示Engine running。
2. 將同一版本的比對工具完整解壓縮到新的私人資料夾，保留Start-Neon-Compare.cmd、Start-Neon-Compare.ps1、Start-Backup.ps1、windows_backup.py、neon_restore.py、neon_compare.py、backup_restore.py及Neon-Compare.Dockerfile。不要只抽出一個啟動檔與舊helper混用。
3. 這一步不需要輸入備份資料夾或金鑰，不會修改原備份。兩個資料庫均須為PostgreSQL18。

工具不要求管理員、不改Windows執行原則、不切換Docker context、不建立主機port，也不掛載整個個人資料夾。

## 取得兩個私人網址

來源Render：

1. 到目前家庭記帳的Render PostgreSQL頁面。
2. 按Connect，選External。
3. 複製完整Database URL，以postgresql://或postgres://開頭，不要複製psql命令。

目標Neon：

1. 到fambudget專案、production分支，按Connect。
2. 選擇這次已還原並準備承接正式網站的資料庫與角色。
3. **關閉Connection pooling**，複製完整PostgreSQL URL。主機名稱不可含-pooler。

網址只貼到下述本機隱藏輸入欄位，不貼聊天、Git、截圖、命令列或檔案。工具固定核對目前已確認的Render來源，並強制TLS主機驗證及channel binding，不接受hostaddr、service、options等轉送設定。

## 執行

1. 再次確認協作者已啟用維護模式，期間不要操作網站或邀請成員記帳。
2. 按兩下**Start-Neon-Compare.cmd**。
3. 等待本機Docker環境檢查及映像準備完成。
4. 出現**Render External Database URL**時，貼來源Render完整網址，按Enter。輸入會隱藏。
5. 出現**Neon direct Database URL**時，貼目標Neon完整直接網址，按Enter。
6. 等待結果，不要關閉Docker。

連線網址只經過工具stdin傳入容器，不寫進命令列、環境設定或一般檔案。資料庫比對使用repeatable-read唯讀交易；工具會確認transaction_read_only=on，不呼叫nextval或setval。比較public資料列與照片雜湊、欄位／型別／預設值／限制／索引，以及流水號參數與目前狀態；因平台角色不同而產生的owner與ACL差異不列為結構不一致。

## 如何看結果

- **「來源與目標的資料、照片、結構及流水號一致」**：本次比對通過。工具仍不會切換網站。保持維護，將安全報告交給協作者，繼續核對後續切換。
- **「來源與目標有差異，尚不可切換網站」**：已完成比對但資料不同。即使表／列／照片總數相同，也可能有內容、索引或流水號差異。保持維護並交付報告，不要直接切換。
- **「尚未完成（階段／代碼）」**：技術失敗，不能當成一致。只回報固定階段與代碼，保留現有資料庫及備份。

報告位置為：

`%USERPROFILE%\FamBudgetMigrationComparisons\本次識別碼\comparison.json`

可提供這個comparison.json；它只含固定狀態／代碼、布林結果、版本、總數、時間與雜湊，不含網址、密碼、資料列、表名或照片內容。啟動器會檢查報告格式，並在匯出後核對報告SHA256。原始伺服器錯誤可能包含秘密，因此不直接列印。

報告的status=verified、match=true，以及dataMatched、schemaMatched、sequenceMatched、readOnly、sourceMaintenanceObserved全部為true才表示此輪比對通過。程式退出碼0代表一致、2代表有差異、1代表未完成；畫面最後的「Press any key to continue」只是等待關閉視窗，不能單獨視為成功。

## 若有差異或失敗

- SOURCE_MAINTENANCE_REQUIRED：維護模式未確認；不要自行取消保護。請協作者核對維護部署及網站可達性。
- TARGET_POOLER_UNSUPPORTED：到Neon關閉Connection pooling，重新取得直接URL。
- SOURCE_URL_INVALID／TARGET_URL_INVALID：核對是完整URL，來源選External、目標選直接連線；不用把網址貼給協作者。
- SOURCE_VERSION_UNSUPPORTED／TARGET_VERSION_UNSUPPORTED：來源與目標須為PostgreSQL18。
- READ_ONLY_REQUIRED：無法確認唯讀交易，停止處理，不略過檢查。
- OPERATION_FAILED：可能為連線、權限或查詢問題；回報階段及代碼即可。

若為DATABASES_DIFFER，須在維護期間另作最後的新來源加密備份，並還原到**另一個全新的空Neon資料庫**後重新比對。不要刪除或清空目前已驗證的Neon副本；也不要對非空目標反覆執行Start-Neon-Restore.cmd。新備份的密文與獨立金鑰分開保存。

## 比對通過後

保持維護，協作者核對報告，再由使用者在Render私人設定中更新DATABASE_URL。必須使用剛才已比對的**同一個Neon直接端點及資料庫**。準備中的/capabilities.database_identity_sha256應與報告targetIdentitySHA256相同；這只是設定識別，**不證明實際連線、憑證或資料內容有效**，仍須確認部署、啟動／遷移及網站操作。

驗收完成前保留Render來源、Neon副本及加密備份；新Neon開始接收寫入後，不可直接切回舊Render而忽略新資料。工具正常結束會停止本次專用容器並保留私人volume，不會動其他容器或原故障環境。
