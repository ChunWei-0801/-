# 私有資料庫與照片備份

`backend/tools/backup_restore.py` 將整個資料庫備份為加密檔，並在還原後核對所有表格列數、每列內容的 SHA-256、照片 BLOB 數量、位元組數及雜湊。頭像、登入背景、記帳照片、拼圖原圖與成就牆背景都存於資料庫；不需要公開照片目錄或把照片放到 GitHub。

## 保管位置與金鑰

備份目錄必須在 Git 工作目錄之外。工具將目錄權限設為 `700`、檔案設為 `600`；還原時拒絕覆蓋現有 SQLite 檔案，PostgreSQL 則必須使用另一個空資料庫。不要把備份、還原資料庫、金鑰或 `.env` 提交到 GitHub。

使用獨立秘密管理服務提供 `BACKUP_PASSPHRASE`（至少 32 位元組），或以 `--key-file /private/keys/backup.key` 指定權限 `600` 的私有金鑰檔。金鑰與備份應分開保管，不能只留在會清除的開發機或容器內。密碼不會出現在命令列參數或報告中，工具不會讀取 `.env`。

每份備份有兩個必須一起保留的檔案：`.enc` 加密資料，以及 `.json` 驗證資訊。AES-256-CBC 使用 PBKDF2-SHA256（200,000 次），HMAC-SHA256 驗證加密內容雜湊與所有驗證資訊；還原會先檢查 HMAC 與加密檔 SHA-256，再解密。請另外保留金鑰，並把這兩個檔案複製到私人、限制存取的異地儲存空間。工作區內的備份只是一份本機副本。

## SQLite：保留原環境，還原至新位置

需要 Python 3 與 OpenSSL。以下從專案根目錄執行，路徑為範例：

```bash
umask 077
python backend/tools/backup_restore.py --key-file /private/keys/backup.key sqlite-backup \
  --source /srv/fambudget/backend/demo.db \
  --destination /private/backups/fambudget

python backend/tools/backup_restore.py --key-file /private/keys/backup.key sqlite-restore \
  --manifest /private/backups/fambudget/sqlite-TIMESTAMP.json \
  --target /private/restore-drill/verified.sqlite
```

SQLite 使用線上備份 API，包括已提交的 WAL 資料，不直接複製正在使用中的資料庫檔。備份快照與還原後的資料庫都要通過 `PRAGMA integrity_check`。原資料庫以唯讀模式開啟，工具不會修改原檔、原容器或原 volume。

## PostgreSQL：一致性快照與獨立還原

需要 `backend/requirements.txt` 的 psycopg、OpenSSL、與資料庫主版本相容的 `pg_dump` 和 `pg_restore`。來源 URL 由秘密管理服務注入 `DATABASE_URL`，新的空資料庫 URL 注入 `RESTORE_DATABASE_URL`。不要把 URL 直接放進命令列。

```bash
umask 077
python backend/tools/backup_restore.py --key-file /private/keys/backup.key postgres-backup \
  --url-env DATABASE_URL --destination /private/backups/fambudget

python backend/tools/backup_restore.py --key-file /private/keys/backup.key postgres-restore \
  --manifest /private/backups/fambudget/postgresql-TIMESTAMP.json \
  --url-env RESTORE_DATABASE_URL --temporary-directory /private/restore-drill
```

來源使用唯讀、可重複讀取交易並匯出快照，`pg_dump` 與雜湊核對使用同一個快照。備份涵蓋應用程式 `public` schema 的表格、索引、約束與序列，不包含伺服器角色或其他資料庫。還原在單一交易內執行，既有 `public` schema 的建立項目會略過；不執行 `DROP`、`--clean`、清空資料或建立資料庫。來源與目的資料庫必須不同，目的資料庫不能已有表格、檢視或序列。

工具只在完全核對成功後回傳 `"verified": true`。PostgreSQL 失敗時抑制可能含私人資料列的資料庫錯誤輸出；請在受控環境檢查該備份，不要把資料庫原始錯誤貼到公開議題。

## 已執行的還原驗證

2026-10-17 原 SQLite 的備份及獨立還原已實測：26 張表、53 列資料、3 個照片 BLOB，共 2,860,132 位元組。完整內容與照片雜湊一致，`integrity_check` 成功，原始資料庫檔案的 SHA-256 前後相同。

另以全新、獨立的 PostgreSQL 16 測試資料庫實測備份及還原：2 張表、2 列資料、2 個照片 BLOB，共 21,256 位元組。資料與照片雜湊一致；自增序列繼續正確遞增；回復至來源資料庫及非空目的資料庫均被拒絕。這是隔離還原演練，正式部署資料庫仍應另外執行備份與還原演練。

可重跑不需外部服務的六項驗證：

```bash
python -m unittest discover -s backend/tests -p test_backup_restore.py -v
```

測試涵蓋真實照片位元組還原、WAL 已提交資料、錯誤金鑰、驗證資訊竄改、加密檔損壞、覆蓋防護與 Git 目錄防護。

## 2026-10-20 私人異地下載還原

使用者明確指定已連接的私人 Google Drive 作儲存目的地。原始快照與生活功能 QA 快照的加密檔、驗證資訊已上傳，復原金鑰存於另一個私人資料夾；逐一讀回權限均為未分享、僅本人擁有。沒有上傳未加密的資料庫、原始專案壓縮檔或公開照片。

兩組都從 Drive 重新下載加密檔、驗證資訊和金鑰，與本機原件逐位元組雜湊一致，再使用下載的金鑰還原到全新隔離位置。原始快照核對 26 表／53 列／3 張照片（2,860,132 位元組）；QA 核對 31 表／95 列／4 張照片（13,628 位元組）。完整列內容及照片雜湊一致，原始資料庫未變動。私有驗證紀錄 SHA-256 為 `3b834ecb13e5a23aedc7d9b45dd7751fa1cf2ab32516737556fc0a4d566ebe6b`，亦已保存到私人 Drive。

備份與金鑰雖分成資料夾，仍屬同一個 Drive 帳號，不能宣稱能抵禦該帳號整體失效；建議另存一份離線金鑰。這次驗證只涵蓋明確列出的歷史／測試快照，正式 PostgreSQL 尚缺連線權限，正式備份、隔離還原、定期異地備份與免費資料庫到期前的保留方案仍待完成。
