# 家庭記帳備份與復原

截至2026-10-23，已有一份正式應用程式資料的私人異地備份，並已從Google Drive下載副本、真正還原驗證。快照時間為**2026-10-23 21:57:07（臺灣時間）**；獨立驗證完成於**22:15:19**。

| 本次已核對項目 | 結果 |
| --- | --- |
| 應用程式資料表／資料列 | 33表／37列 |
| 資料庫照片BLOB | 3個，共2,983,651bytes |
| 私人異地保存 | 密文及相關JSON、復原金鑰分開放在owner-only資料夾 |
| 原檔下載與完整性 | 四檔provider大小吻合；密文／manifest／金鑰與原Windows SHA256吻合 |
| 備份驗證 | manifest HMAC、密文SHA256、來源識別通過 |
| 真正隔離還原 | 新PG18容器，所有資料列與照片雜湊吻合 |
| 演練後清理 | 明文、驗證容器及其專用volume已清理；臨時金鑰副本已移除 |
| 驗收證明 | 私人Drive保存，下載回驗SHA256一致 |

本次密文SHA256：

```text
f25037290dd42e85f0b4746a8180b9c62584d49f52c7b5e3d96f6095bd51b9b4
```

這份副本只保護快照當時的資料。**目前沒有排程自動備份**；之後的新增、修改與照片，需要另作新備份。備份可復原已經實測，但不代表未來變動會自動進入這份舊快照。

1. **保留哪些內容。** 備份範圍是應用程式的`public` schema，含資料表、資料、資料庫內照片，以及`pg_dump`收集的結構。程式與文件另外保存在GitHub。此資料備份不保存Render平台設定、全伺服器角色或原本的資料庫擁有者／ACL；沒有宣稱備份所有外部服務。實際Drive位置只留私人接續紀錄，不放進Git。金鑰與備份分開保留，兩者缺一就不能完整復原。

2. **製作下一份備份。** 在自己的Windows電腦開啟Docker Desktop，使用[Windows工具說明](../tools/windows-backup/README.md)執行`Start-Backup.cmd`。工具來源已驗證的commit是`78f3a4b38b41d45b446209223896cbf2983d8d8f`；Dockerfile固定官方PostgreSQL18.6 bookworm映像digest。來源External URL只在本機隱藏輸入，不能貼到聊天、Git或紀錄檔。工具用唯讀一致快照匯出，加密後建立全新隔離資料庫還原、逐表及照片核對。必須看到成功結果，不能用建置完成或單純有`.enc`檔當成驗收通過。

3. **保存並驗證異地副本。** 每次使用新run資料夾，保留舊版本。將`.enc`、manifest JSON、`verification.json`放入私人備份資料夾，`backup.key`放另一個私人金鑰資料夾。先核對父／子資料夾與檔案權限只有預期owner，再透過已授權的Drive連線下載原檔。非Google原生檔案使用原始檔下載，不作格式轉換。比對provider大小；若介面有提供checksum欄位，才另外核對並記錄。比對`verification.json`中的密文／manifest／金鑰SHA256，再驗證manifest HMAC。不得把金鑰內容、完整manifest、私人檔案位置或資料列放到Git。安全驗收摘要可記錄時間、總數與密文SHA256。

4. **建立全新隔離還原環境。** 由已保存的Dockerfile與核心工具組裝映像；建置context只包含Dockerfile、`windows_backup.py`及`backend/tools/backup_restore.py`三個公開程式檔。使用已確認是本機的Docker context／socket，每次建立唯一名稱與owner標記的新容器、volume。加上`--init --network none`，不要發布任何host port，不使用host networking，不改原容器。將下載檔複製到volume內分開的備份／金鑰輸入目錄；目錄須root擁有、700，檔案600。不要把整個個人資料夾掛入容器。

   已提交的`windows_backup.IsolatedRestore`能在容器內建立獨立PG18叢集：只聽127.0.0.1、有隨機密碼、使用localhost TLS及`verify-full`。核心工具`backup_restore.postgres_restore`在解密前驗證HMAC及密文SHA256，拒絕與來源相同的識別及非空目標，沒有`--clean`、DROP或truncate來源資料的操作。來源識別須與私人設定及本次驗收紀錄核對，不能拿另一份資料集冒充。還原server／client須與dump相容；本次source及client major均18。

   以下是供後續維護者在該容器中重建驗證程序的介面骨架。路徑變數須由私人工作區提供，不是把金鑰或資料庫網址填進命令列。執行前先按第3步完成檔案雜湊、來源與原始驗收報告核對：

   ```python
   import json, os, sys
   from pathlib import Path
   sys.path.insert(0, "/app")
   import windows_backup

   core = windows_backup.load_backup_module()
   windows_backup.preflight()
   manifest = Path(os.environ["FAMBUDGET_MANIFEST_FILE"])
   key = core._key(os.environ["FAMBUDGET_KEY_FILE"])
   work = Path(os.environ["FAMBUDGET_PRIVATE_RESTORE_WORK"])
   drill = windows_backup.IsolatedRestore()
   result = None
   safe = {"verified": False}
   try:
       target = drill.start(core)  # 新建空叢集；不能替換成正式資料庫URL
       result = core.postgres_restore(manifest, target, key, work)
       safe = core._summary(result)  # 只輸出統計，不輸出完整inventory
   except BaseException:
       safe = {"verified": False, "code": "RESTORE_FAILED"}
   finally:
       cleaned = drill.cleanup()
       safe["plaintextRemoved"] = cleaned
       if not cleaned:
           safe["verified"] = False
   print(json.dumps(safe))
   ```

   完整驗收還須檢查沒有殘留明文dump與演練資料庫、確認新容器沒有對外網路或公開port，且所有表的資料列／照片雜湊和authenticated manifest相同。本次數量為33／37／3；未來備份應採該次manifest的實際數量，不能預填本次數字或只比總數。

5. **保存證據後清理本次演練。** 將安全結果寫入私人驗收證明，再上傳並下載回驗SHA256。停止演練PG並確認明文已刪除後，才移除這次新建且標記核對過的驗證容器／volume及臨時金鑰副本。保留Drive原檔、Windows原始備份及獨立金鑰，不重設Docker、不刪除原故障環境。若強制中止或清理失敗，將容器與volume保持私人，不得整個分享或上傳；結果必須標示失敗。

6. **真正事故復原與網站切換。** 先在另一個全新空資料庫完整還原及核對，再測試登入、帳務、照片與目前程式版本相容性；如需遷移，先在新環境驗證。提供可審查的資料比對、切換與回退方案，經使用者確認後才變更正式網站的資料庫設定。不要直接還原覆蓋目前正式資料庫，也不要把演練驗證當成已經完成網站切換。遺失部分新資料時，應評估差異與可恢復時間點，不能假設本次舊快照含有之後所有變更。

正式網站目前仍是v178；本次備份驗收未更動應用程式或部署。原故障SQLite雜湊與容器狀態已再次確認未變更。來源憑證更換須另外協調網站設定，不能把備份完成當成已自動更換密碼。
