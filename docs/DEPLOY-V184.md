# v184發布接續：程式已驗證，網站尚未更新

目前正式網站仍為v183，網址是 https://fambudget-recovery-20261017.onrender.com 。本對話的執行工作區在發布前中斷，因此不能把程式保存或CI通過當成已更新網站。

已驗證來源：`bce6ef04dda5d474f02cf7261d17d90c98607c15`；來源樹：`52bf82122e505fa6411c3f3d6af37ca5a6b60a01`。

- [一般功能、Windows與後端測試](https://github.com/ChunWei-0801/-/actions/runs/40274337261)：三個工作全通過；後端1276、瀏覽器83及生活功能獨立流程通過。
- [三核心相容性測試](https://github.com/ChunWei-0801/-/actions/runs/40274337200)：Chromium、Firefox、WebKit，桌面與手機／窄螢幕共十二項通過，零跳過。裝置設定與真機驗收有別，見[完整範圍](BROWSER-COMPATIBILITY.md)。

## 工作區恢復後接續

重新連接原專案工作區，從GitHub取得最新的 `recovery/household-20261017`。中斷後的相容性與交接更新僅保存在GitHub，本機舊工作樹可能仍停在較早階段；保留原工作樹，使用乾淨的新工作樹讀取遠端來源。發布上述已驗證的特定來源；文件更新提交不改變應用程式內容。

目標為既有免費Render Web Service：`fambudget-recovery-20261017`（`srv-db9opo61egvs7382obu0`），分支 `recovery/household-20261017`，autoDeploy目前關閉。最後一次唯讀檢查確認沒有維護模式環境變數。發布前再次確認方案為Free，保持目前私人的DATABASE_URL；這次功能更新不等於Neon切換。

## 如由使用者在Render自行發布

1. 開啟Render Dashboard，選擇Web Service「fambudget-recovery-20261017」。
2. 核對免費方案、儲存庫及上述分支，使用「Manual Deploy」中的特定提交選項，指定 `bce6ef04dda5d474f02cf7261d17d90c98607c15`。若介面未提供特定提交選項，先恢復專案工作區，再使用已備妥的固定來源發布流程。
3. 等候部署顯示Live。啟動命令會套用0010／0011兩個新增遷移，再啟動網站；只更新前端檔案不足以啟用新功能。不要改成付費方案、重設資料庫或刪除原資料。
4. 重載網站，到「設定 → 資料匯入與保存」，確認「匯入付款紀錄」、「每月報表與雲端保存」、「常用買方統編」三個入口；核對原明細與照片。
5. [月報](FREE-PAYMENTS-AND-MONTHLY-REPORTS.md)仍需本人首次在Google安裝並授權。部署本身不會寄信或上傳雲端，也不是完整自動備份。

目前仍沒有本次正式部署或正式全站實機驗收證據；真正發布後，應再記錄實際部署來源、狀態與時間。
