# 2026-10-24 Windows Neon還原工具

使用者已建立Neon Free／Oregon／PostgreSQL18專案，並回報重新備份來源35表、41列、3張照片。這是使用者回報，不是本次工具的Neon還原結果。Render來源2026-11-16到期，建議11-09前完成驗收；沒有自動排程或付費升級。

新增Start-Neon-Restore.cmd／ps1、neon_restore.py、Neon-Restore.Dockerfile、操作說明及Windows檢查。原Start-Backup.ps1新增僅匯入helper的早退模式，原備份流程不變；新啟動器重用已測試的native argv、私人ACL及本機Docker選擇。

還原網址只經Windows隱藏輸入與本機容器stdin，不進argv、Docker環境、Git或報告。只接受直接Neon endpoint，拒絕pooler／路由覆寫，強制verify-full、系統CA及channel binding。先驗證加密備份HMAC與密文SHA256、已確認來源識別、24小時內時間戳及含行事曆的目前schema，再檢查PG18與空public schema。使用既有postgres_restore的單一transaction、no-owner/no-acl及資料列／照片雜湊核對。沒有清空、DROP、覆寫目標或修改來源的路徑，也不切換網站。

Windows結果只接受白名單JSON。修復並測試helper匯入會重設CheckOnly、PowerShell自動將ISO字串轉DateTime，以及早期錯誤沒有容器報告卻掩蓋原代碼三個問題。成功報告匯出後驗SHA256；早期失敗保存白名單stdout報告。只清除本次容器金鑰副本，保留原Windows備份與原金鑰；私人volume保留供故障核對。

完整後端1111通過（新增runner16例）；本機PowerShell還原26通過，8個Windows專用案例待CI；原啟動器本機27通過。以真正PG18.6、TLS和非superuser目標跑合成6表10列3張照片：實際還原、所有資料列與照片雜湊及sequence一致、非空目標拒絕且不修改、實際密文毀損在目標連線前拒絕、來源不變及報告清理通過。合成備份使用明確標記的來源識別fixture，沒有連Render或Neon，不冒充使用者35／41／3。

CI會在Windows5.1跑兩個啟動器檢查，並提供獨立FamBudget-Windows-Neon-Restore下載包及檔案雜湊清單。這一階段不部署網站，主站v181維持原資料庫。正式Neon還原、最新來源一致性、健康檢查省額度調整、停止寫入及切換仍是後續步驟；不能將此工具測試當成搬家完成。


## 下載包驗證

工具來源`ec388cbf0f6368d7b39bab37041de84f92b4c712`、14個變更blob已核對。[CI40083147653](https://github.com/ChunWei-0801/-/actions/runs/40083147653)的checks／browser／windows-backup均成功；Windows PowerShell5.1原備份啟動器44通過、新Neon還原34通過，Windows專用8例均有執行。獨立下載包[12555843339](https://github.com/ChunWei-0801/-/actions/runs/40083147653/artifacts/12555843339)已產生，含sourceCommit與檔案SHA256清單，保存至2026-11-23。這些是工具驗證，使用者的Neon尚未由工具還原，正式網站未切換。
