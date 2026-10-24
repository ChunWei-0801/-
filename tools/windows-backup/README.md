# Windows 私人資料庫備份與還原驗證

這個工具在**你自己的 Windows 電腦**上執行，使用正常網路連線至 Render External 資料庫。它不會修改 Codex 的網路設定，也不需要設定 VPN。

目前提供的是操作工具。**在你的電腦實際執行成功以前，不能視為正式資料庫已備份。** 本工具不會自動上傳 Google Drive，異地備份仍需另外完成上傳、下載與核對。

## 下載

[下載已通過 Windows 檢查的工具 ZIP](https://github.com/ChunWei-0801/-/actions/runs/39961984162/artifacts/12504733222)，需要登入有儲存庫存取權的 GitHub 帳號，下載保留至2026-11-22。解壓縮後，直接使用其中的 `Start-Backup.cmd`。

若下載已到期，可改下載[完整來源 ZIP](https://github.com/ChunWei-0801/-/archive/78f3a4b38b41d45b446209223896cbf2983d8d8f.zip)，解壓縮後開啟 `tools/windows-backup/Start-Backup.cmd`；啟動器也支援完整來源資料夾。

## 先準備

- Windows 10／11 與 Windows PowerShell 5.1。
- 已安裝並開啟 [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)，使用本機 **Linux containers**。安裝可能需要重新啟動電腦及啟用虛擬化，工具不會代你安裝或變更管理員設定。
- Docker Desktop 對教育及符合其條件的個人使用可免費使用；請依 [官方授權條件](https://docs.docker.com/subscription/desktop-license/)確認你的情況。
- 初次建置需要下載官方 PostgreSQL 映像與必要套件，請預留網路時間及磁碟空間。
- 本機網路必須能正常存取 Render External PostgreSQL。若 Render 設定了來源 IP 限制，需透過你有權管理的 Render 設定允許這台電腦的來源 IP。

## 執行

1. 將提供的 Windows 工具 ZIP 解壓縮至一般資料夾；保留同一資料夾中的 Dockerfile、Python 程式與啟動檔。也可使用完整 GitHub 儲存庫中的 `tools/windows-backup` 資料夾；啟動器會自動找到 `backend/tools/backup_restore.py`，不必自行複製程式。
2. 開啟 Docker Desktop，等候引擎啟動完成。
3. 按兩下 **Start-Backup.cmd**。
4. 程式先檢查本機 Docker，再建立工具映像及本次專用容器。出現提示後，在這台電腦貼上 Render「Connect → External」的完整 Database URL，按 Enter。輸入會隱藏。
5. 等待畫面顯示完成或安全錯誤代碼。**不要把網址、密碼、金鑰或含有它們的截圖貼到聊天。**

如只想檢查必要工具，可在 PowerShell 執行：

```powershell
.\Start-Backup.ps1 -CheckOnly
```

啟動 `.cmd` 時的 ExecutionPolicy Bypass 只作用於該次 PowerShell 子程序，方便執行下載的本工具；不會永久修改 Windows 執行原則。若組織原則禁止執行，請依組織正常流程處理，勿繞過管理限制。

## 成功時會做什麼

- 來源使用 TLS 主機驗證及唯讀一致快照，保留來源資料。
- 備份應用程式 `public` schema 的資料表及資料庫內照片，加密後以驗證碼保護完整性。
- 在本次容器中建立全新隔離資料庫，真正還原並比對每張表的資料列及照片雜湊。
- 刪除本次還原演練的明文資料庫及臨時明文 dump；保留加密檔與獨立金鑰。
- 將加密備份與金鑰複製到 Windows，逐檔核對 SHA256，並檢查資料夾僅允許目前使用者與 SYSTEM 存取。
- 關閉本次容器，但保留本次專用 Docker volume，防止匯出失敗後只剩唯一副本。

備份與金鑰分開存放：

```text
%USERPROFILE%\FamBudgetBackups\本次時間及識別碼\
%USERPROFILE%\FamBudgetRecoveryKeys\本次時間及識別碼\backup.key
```

請將兩者分開備份至私人位置。**遺失復原金鑰將無法解密；把金鑰與加密檔一起分享，等同交出資料。** 不要把金鑰放進 Git 或公開雲端資料夾。

## 若沒有完成

請保留畫面列出的本次 volume、已產生的備份與金鑰；不要重設 Docker 或刪除 volume。僅回報階段和代碼即可。失敗不會被標示成驗證成功，也不會還原到來源資料庫。

若強制關閉視窗或 Docker，暫存資料可能來不及清除。請將本次容器與 volume 保持私人，**不要上傳或分享整個 volume**；只有完成清理與驗證的加密匯出檔才適合做後續異地備份。

每次執行都建立新的容器、volume 與輸出資料夾，避免覆蓋前一次結果。程式不會刪除其他 Docker 資源，也不會變更原故障環境。

建置 Docker 時只會將 Dockerfile、啟動所需的 Python 程式及備份核心複製到新的小型暫存資料夾，建置後移除。完整儲存庫、`.env`、資料庫網址與其他個人檔案都不會進入建置內容。來源連線失敗或還原失敗時會顯示實際的安全階段／代碼；若已建立加密備份，仍會嘗試匯出並保留金鑰與 volume，供後續處理。

資料庫網址只在本次程式記憶體與送往本機容器的標準輸入中使用，不放入命令列、容器環境變數、程式碼或檔案。執行前請關閉自行啟用的除錯追蹤／逐行追蹤；請勿錄製輸入過程。


## 還原到新的 Neon Free 資料庫

另有[Neon還原工具](NEON-RESTORE.md)，使用獨立的Start-Neon-Restore.cmd；它只建立並驗證目標副本，不切換網站。原Start-Backup.cmd仍維持唯讀來源備份與隔離還原流程。
