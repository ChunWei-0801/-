# 免費資料庫搬移準備

2026-10-26補充：已部署的v184（`bce6ef04dda5d474f02cf7261d17d90c98607c15`）包含付款匯入與月報的0010／0011新增遷移，以0010／0011新增4張應用資料表。隔離PostgreSQL18演練保留34張既有應用表與照片；遷移定義的預期結果為38張應用表（含alembic_version共39張），本次未直接查詢正式表數。Render已確認v184上線，仍使用原Render資料庫連線；維護未啟用，也未切換Neon。原Neon35表／41列／3照片仍只是先前快照；將來切換前須重新凍結來源、最後備份、還原到另一個空Neon資料庫並唯讀比對，保留既有已驗證副本。

## 到期與授權範圍

2026-10-24使用者Render Info截圖確認：fambudget-recovery-db-20261017為Free、PostgreSQL18、Available，1GB已用7.12%；**2026-11-16到期，未升級將刪除**。畫面未顯示精確到期時間與時區。建議2026-11-09前完成切換及驗收以留緩衝；這不是已建立的排程。

使用者已選擇保留線上家庭共用、僅用免費額度，到期或改收費搬移；不授權付費升級。新平台帳號屬於使用者本人。目前網站仍使用Render資料庫，未啟用維護模式、未切換正式連線、未刪除來源，也未開通付費資源。

## 已建立的目標：Neon Free

使用者概覽截圖確認Neon專案fambudget、production分支、Free plan、AWS US West 2（Oregon）、PostgreSQL18。**Expires Never只表示該分支未設定到期日，不表示方案永久不收費。**

已讀取Neon官方GitHub網站文件，plans頁updatedOn為2026-10-23：Free $0/month；每專案1GB PostgreSQL storage、每月100 CU-hours、5GB public network transfer。運算與傳輸額度按月重設；用完會暫停compute到下個週期或升級，Free容量用完會阻擋增加容量的操作。文件說明這些額度限制不會刪除資料。仍須保留獨立備份，供應商政策可能變更。

官方文件確認支援PostgreSQL14–18；目前來源、目標與工具均採18。若控制台要求付費，先核對，不能直接升級。

參考：

- https://neon.com/docs/introduction/plans
- https://neon.com/docs/postgresql/postgres-version-support
- https://neon.com/docs/introduction/scale-to-zero
- 官方原始文件：https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md

## 已接受的還原證據

使用者在自己的Windows執行[Neon還原工具](../tools/windows-backup/NEON-RESTORE.md)，回報成功並上傳安全的verification.json。報告已檢查：schemaVersion1、status=verified、code=OK、stage=complete、restoreVerified=true、plaintextRemoved=true，clientMajor與targetMajor均為18。

這份備份時間為**2026-10-24 13:39:28 Asia/Taipei**（UTC 05:39:28.489579），內容為**35張表、41筆資料、3個照片BLOB，共2,983,651照片位元組**。報告表示工具已在使用者電腦完成備份驗證、Neon還原、資料與照片雜湊核對及明文清理。這是接受使用者提供的工具報告；本執行環境沒有取得私人連線網址，也沒有直接查詢正式Render或Neon。

它只證明該時間點快照已還原，**尚未證明目前Render資料與Neon完全一致，也不是網站已搬家**。這次新備份的異地複本尚未獨立下載核對。先前已驗證的私人Drive備份是2026-10-23 21:57的33表／37列／3照片，兩者範圍不同，不能混用。

## 切換前的下一階段

1. 維護模式與[Windows唯讀比對工具](../tools/windows-backup/NEON-COMPARE.md)已完成程式檢查並保存於`6c14cff082453479c2ffbb846724ca4ef6f2c8b7`；[CI40107628444](https://github.com/ChunWei-0801/-/actions/runs/40107628444)三工作全通過：backend1211、browser57、Windows比對57（非跳過）及原備份44／還原34。實際隔離PostgreSQL18/TLS合成演練13項通過，沒有連正式Render或Neon。[新版比對下載包](https://github.com/ChunWei-0801/-/actions/runs/40107628444/artifacts/12564998401)需登入有儲存庫權限的GitHub帳號，保留30天。**維護程式已隨v184部署，但目前未啟用。仍須先確定維護時段、啟用並確認所有API暫停及請求排空後，才能進行最後唯讀比對。**
2. 在確定維護時段後，讓網站所有API操作暫停，等待舊部署及進行中請求結束。部分GET會建立偏好資料，所以只停新增按鈕或只擋POST不足以凍結來源。
3. 維護期間用本機隱藏輸入取得來源Render External URL與目標Neon直接URL，唯讀比較目前資料列、照片、資料表欄位、限制、索引與流水號狀態。工具不會執行還原、刪除、更新或網站切換；單看35／41／3的總數不能判定一致。
4. 若不一致，維持維護並做最後的新來源備份，還原到**另一個全新空Neon資料庫**，再比對。保留目前已驗證的Neon副本；不要刪表、清空或重複還原到非空目標。
5. 比對通過後，才把正式服務的私人DATABASE_URL設為同一個已比對的Neon直接端點及資料庫，保持JWT、郵件與網站網域設定。密碼只在本機隱藏欄位或供應商秘密設定內處理，不貼聊天、截圖、命令列或Git。
6. 維護仍開啟時核對部署成功、資料庫遷移／啟動成功、資料庫提供者及目標識別，再解除維護，驗收登入、收支明細、活動權限、照片與行事曆。
7. 保留來源及備份直到新站驗收。新目標開始接收寫入後，不能直接切回舊來源，否則會遺失新資料；需先作新備份及處理兩邊差異。

已部署的/capabilities.database_identity_sha256只將設定中的端點、port與資料庫路徑作雜湊，用於比對報告的targetIdentitySHA256；它**不會連資料庫，也不證明憑證有效、實際連線成功或資料一致**。須與部署／啟動及實際操作驗收一起判讀。比對及切換都使用同一個直接端點；pooler主機名稱不同，識別值也會不同。

## 免費額度的整合檢查

Neon Free閒置5分鐘會scale to zero。先前部署的Render健康檢查為/readyz，該路由每次查資料庫，可能讓資料庫持續活動而消耗月運算額度。v184發布後已由Render API確認常態存活檢查為不查DB的/healthz；保留人工／部署前的/readyz就緒確認。

已通過程式與隔離測試、並隨v184部署的準備也包含Neon應用連線的TLS主機驗證及channel binding；不能將程式碼準備等同正式連線已驗收。SQLAlchemy連線池須配合閒置重啟行為檢查。行事曆提醒另有每分鐘查詢，頁面長時間開啟仍會累積運算時間，不能只改健康檢查就宣稱沒有閒置消耗。不要用定時ping或外部保活規避免費方案休眠。

## 尚未完成

目前Render最新狀態與Neon唯讀比對、最後一致快照（若有差異）、正式連線切換、實際網站驗收，以及新備份異地核對均未完成。沒有自動搬家、額度監控或自動備份排程。
