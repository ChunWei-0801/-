# 免費資料庫搬移準備

## 到期與授權範圍

2026-10-24使用者Render Info截圖確認：fambudget-recovery-db-20261017為Free，PostgreSQL18，Available，1GB已用7.12%；2026-11-16到期，未升級將刪除。未顯示精確到期時間與時區。建議2026-11-09前完成切換及驗收以留緩衝；未建立任何自動排程。

使用者已選擇保留線上家庭共用、僅用免費額度，到期或改收費搬移；不授權付費升級。目前不變更正式服務連線、不刪資料、不開付費資源。新平台帳號需屬於使用者本人。

## 相容候選：Neon Free

已讀取Neon官方GitHub網站文件，plans頁updatedOn為2026-10-23：Free $0/month；每專案1GB PostgreSQL storage、每月100 CU-hours、5GB public network transfer。compute與transfer額度會按月重設。運算或傳輸用完會暫停compute到下個週期或升級；Free容量用完會阻擋增加容量的操作。文件說明這些額度限制不會刪除資料。仍須保留獨立備份；此資料不是供應商永久不改價的保證。

官方文件確認目前支援PostgreSQL14–18。目標專案應選18，與來源及目前備份工具一致。帳號／建立專案畫面須確認Free；如果畫面要求付費或條件與文件不同，先停在該頁核對，不能直接開付費方案。

參考：
- https://neon.com/docs/introduction/plans
- https://neon.com/docs/postgresql/postgres-version-support
- https://neon.com/docs/introduction/scale-to-zero
- 對應官方原始文件：https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md

## 使用者下一步

1. 到https://neon.com/建立自己的帳號，可使用GitHub登入。
2. 選Free，進入建立Project頁。建議名稱fambudget、PostgreSQL18、地區AWS Oregon（若可選，接近目前Render Oregon）。保持預設資料庫名稱即可；不需要替現有帳號換密碼。
3. 在送出前核對方案為Free。完成後只提供專案概覽或方案頁截圖，遮住所有連線網址及金鑰。不能把資料庫密碼或完整連線字串貼到聊天。

## 實際搬移前的必要工作

- 做當時最新的正式資料庫一致快照，加密保存。2026-10-23舊快照不涵蓋之後的交易、照片與行事曆；必須另作新備份。
- 在全新目標資料庫還原並核對每表筆數、資料與照片雜湊；確保UUID、JSONB、時間、唯一鍵、索引及Alembic版本完整。不得覆蓋唯一的正式資料庫。
- 用目前程式測試登入、收支明細、活動權限、照片及行事曆；驗證後才安排短暫停止寫入、最後增量／完整新快照、切換連線與回退方案。原網站繼續保留，直到新站驗收。
- 目標還原與應用程式使用符合各自用途的連線方式，保持TLS；密碼用受保護的本機輸入或環境秘密設定，不寫進命令列、聊天或Git。

## 免費額度的整合檢查

Neon Free閒置5分鐘會scale to zero。現在Render健康檢查設定是/readyz，該路由每次都查資料庫；若直接沿用，可能讓目標資料庫持續活動，消耗月運算額度。SQLAlchemy連線池也需配合目標閒置連線／重啟行為檢查。行事曆提醒另有每分鐘查詢，網頁長時間保持開啟也會累積運算時間；切換前需一起評估通知查詢、分頁可見性及實際額度，不能僅改健康檢查就宣稱沒有閒置消耗。

切換前需評估改用不查DB的/healthz作常態存活檢查，並保留部署前或人工/readyz就緒確認；不要用定時ping或外部保活去規避免費方案休眠。這是待實作／驗證事項，目前未修改Render健康檢查或正式連線。

## 目前狀態

來源期限已確認。使用者已建立Neon fambudget／production，截圖確認Free plan、AWS Oregon、PostgreSQL18；Expires Never僅表示分支未設定到期日。使用者另回報本次來源備份35表、41列、3張照片，尚未提供備份時間，也未由本次執行環境驗證新備份HMAC或異地複本。

已準備Windows安全還原工具，說明見[Neon還原工具](../tools/windows-backup/NEON-RESTORE.md)。它使用本機隱藏輸入，驗證近期備份及空目標後還原；已做獨立的合成PostgreSQL18 TLS／非superuser實際還原測試，沒有連到正式Render或Neon。尚未取得目標連線或執行正式還原、目標驗收與網站切換；沒有自動搬家。
