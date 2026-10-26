# v184發布紀錄與使用入口

新版已於 **2026-10-26 14:04:11（臺灣時間）** 上線： https://fambudget-recovery-20261017.onrender.com 。

Render部署 `dep-dbfepsqvcj2c73fsll40` 為Live；已驗證並發布的來源為 `bce6ef04dda5d474f02cf7261d17d90c98607c15`，來源樹為 `52bf82122e505fa6411c3f3d6af37ca5a6b60a01`。中斷的工作區已恢復，舊工作樹保留，使用新工作樹完成發布。

## 新功能入口

重新整理網站後，到「設定 → 資料匯入與保存」：

- 「匯入付款紀錄」：選擇CSV／TSV帳單，核對欄位與分類、檢查重複，再確認寫入；不會自動登入銀行或支付帳號。
- 「常用買方統編」：保存、複製或清除常用8碼統編。手動記帳、照片確認及修改明細可逐筆填寫或留白；不會修改已開立發票。
- 「每月報表與雲端保存」：預設本人已驗證信箱，可改選Google Drive或兩者。首次仍需本人在Google安裝並授權Apps Script；發布網站本身不會寄信或上傳。

詳細步驟見[付款、統編與月報操作說明](FREE-PAYMENTS-AND-MONTHLY-REPORTS.md)。

## 已完成的檢查

- [一般功能、Windows與後端CI](https://github.com/ChunWei-0801/-/actions/runs/40274337261)：三個工作全通過；後端1276、瀏覽器83及生活功能獨立流程通過。
- [三核心相容性CI](https://github.com/ChunWei-0801/-/actions/runs/40274337200)：Chromium、Firefox、WebKit，桌面與手機／窄螢幕共十二項通過，零跳過。裝置設定與真機驗收有別，見[完整範圍](BROWSER-COMPATIBILITY.md)。
- Render發布前後確認方案仍為Free、原DATABASE_URL完全相同、維護關閉，健康檢查為`/healthz`。實際啟動命令包含Alembic遷移，並在啟動Uvicorn前執行。
- 新遷移只增加4張表；隔離PostgreSQL18演練確認既有資料與照片一致。本次沒有直接查詢正式資料庫或對正式帳號做測試寫入。

## 尚需使用者確認

實體Android／iPhone的相機、相簿、鍵盤、下載與加入主畫面仍需真機確認；測試不能保證每種瀏覽器、內嵌視窗及舊版本的全部功能相同。本機AI仍需要裝置支援WebGPU，無法使用時提供手動或明確標示的規則解析。

Google月報尚未由使用者安裝排程、未實際收信或存入Drive。月報不是完整資料庫備份。Neon搬移也尚未執行；目前仍使用Render，原Neon副本是先前快照，切換前需重新備份與比對。這些項目不能因本次發布而標示為完成。
