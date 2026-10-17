"""
工具箱。第三方套件的包裝，**完整可用，不是骨架**。

===========================================================================
這個資料夾跟其他資料夾的差別
===========================================================================
    toolkit/    已經寫好了。你 import 來用，不用改也不用讀懂內部
    services/   記帳、統計、照片與拼圖等業務規則

工具箱的存在意義是：**讓你不用去讀 PyJWT、bcrypt、httpx 的文件**。
你只要知道「呼叫這個函式會得到什麼」就好，那些寫在每支函式的說明裡。

===========================================================================
有哪些工具
===========================================================================
    config      設定（環境變數）  settings.database_url；python -m app.cli check-config
    db          資料庫連線與交易          get_db / session_scope / @db_transaction / create_all
    crud        增刪改查（任何一張表）    get / find / save / remove / to_dict
    passwords   密碼雜湊                hash_password / verify_password
    tokens      JWT                     make_access_token / read_access_token
    deps        FastAPI 依賴            current_user_id / paging
    errors      統一的錯誤回應          not_found / forbidden / unauthorized
    period      期間與日期              month_range / recent_months
    money       金額（Decimal）         to_decimal / ratio / quantize
    images      大頭貼驗證              validate_avatar / to_data_uri
    alerts      階段性提醒的門檻計算    usage_percent / crossed / should_fire
    scope       可見範圍（聯集）        visible_users / co_parents / can_see_row
    roles       角色能做哪些治理動作    can_govern / require_govern
    notify      通知發給誰（已去重）    recipients_for
    profile     理財習慣組成 prompt     to_prompt_block / clean_note
    family      家庭綁定（邀請碼、找人）  new_code / hash_code / lookup_status
    theme       介面主題的 id 驗證      THEMES / clean_theme
    ledger      帳本結算、移除、改刪紀錄  require_open / require_editable / clean_ids
    body_limit  請求串流大小限制        APIBodyLimit
    mail_content 多語驗證／重設信件      本地化驗證／重設信件內容
    mailer      寄信（Brevo HTTP API）  send_mail；試寄：python -m app.toolkit.mailer --to 你的信箱
    password_reset 忘記密碼的重設連結   new_token / hash_token / require_usable / mail_content

===========================================================================
怎麼查一個工具怎麼用
===========================================================================
每支函式的說明裡都寫了**參數、回傳、丟出什麼例外、範例**。
在編輯器裡把游標移到函式上就看得到，或是：

    python -c "from app.toolkit import period; help(period.month_range)"

===========================================================================
維護原則
===========================================================================
1. 共用工具的修改應連同呼叫端與測試一併驗證。
2. 記帳、統計與遊戲的業務規則放在 services/，供路由重用。
3. 金額一律走 money 模組，避免浮點數累加誤差。
"""
