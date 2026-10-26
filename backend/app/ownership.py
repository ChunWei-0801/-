"""家庭記帳 API 的領域目錄與檔案索引。

登記實際公開的業務路由，供 API 文件、錯誤提示與一致性檢查使用。
領域表示產品功能分類，不限制任何人的開發或維護權限。

    cd backend
    python -m app.ownership

check() 檢查重複與未登記的路由／檔案；progress() 比對目錄與實際掛載結果。
"""

from __future__ import annotations

import sys

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Member:
    """一個領域：它的邊界、路由與檔案。"""

    key: str
    """程式裡用的代號。"""

    label: str
    """顯示名稱，例如「認證」。"""

    domain: str
    """領域名稱。概述此功能領域。"""

    scope: str
    """功能與權限契約的說明。"""

    color: str
    """文件中代表此領域的顏色。"""

    routes: list[tuple[str, str]] = field(default_factory=list)
    """(HTTP 方法, 路徑) 的清單。這是唯一的路由歸屬定義。"""

    files: list[str] = field(default_factory=list)
    """此功能領域的實作檔案；供索引與文件使用。"""

    shared: list[str] = field(default_factory=list)
    """提供多個功能使用的共用元件。"""



# ===========================================================================
# 產品功能領域。保留穩定的 m1–m4 鍵以相容現有文件與錯誤提示。
# 此分類不代表人員、交付順序或檔案修改權限。
# ===========================================================================
MEMBERS: list[Member] = [
    Member(
        key="m1",
        label="認證",
        domain="認證",
        color="#6C9FFB",
        scope=(
            "負責「你是誰」。\n"
            "屬於他的：註冊登入登出、密碼、忘記密碼、JWT、工作階段、個人資料與大頭貼、介面主題。\n"
            "註冊只問名字、email、密碼；每月存款目標、理財習慣、主題在註冊後的個人化設定問，\n"
            "  走完（或全部跳過）用 PATCH /api/auth/me 的 onboarded 設 users.onboarded_at。\n"
            "忘記密碼：toolkit/password_reset.py 產一次性連結（只存雜湊、30 分鐘），toolkit/mailer.py 用 Brevo 寄出。\n"
            "⚠️ 申請重設時，有沒有這個帳號都回同一句話——不然這支就是帳號列舉工具。\n"
            "地基（資料庫連線、設定、依賴注入、密碼雜湊、JWT 實作）"
            "已經在 toolkit/ 裡寫好了，直接用就好，不用再造一次。\n"
            "停權也在這裡：平台管理員（master）可以停掉違規帳號。\n"
            "⚠️ **停權是關門，不是配鑰匙。** 他停得了人，但讀不到任何一筆帳——\n"
            "  一個能讀全系統消費明細的帳號，比家長越權嚴重得多。\n"
            "⚠️ 停權**不刪任何資料**：擋登入、擋寫入，紀錄全部留著。\n"
            "⚠️ 每一次停權都要寫進 audit_logs，而且要有理由。\n"
            "  沒有稽核的停權就是任意封鎖，被停的人也沒東西可以申訴。\n"
            "verify-password 給「重大操作前再確認一次」用："
            "驗證密碼但不發新的 token。⚠️ 一定要做速率限制，"
            "否則它就是一支免費的密碼嘗試器。\n"
            "不屬於他的：家庭角色與監管關係（那是家庭）。"
            "users 表存的是登入身分，family_members 表才是家庭角色，兩者刻意分開。"
        ),
        routes=[
            ("POST", "/api/auth/register"),
            ("POST", "/api/auth/login"),
            ("POST", "/api/auth/refresh"),
            ("POST", "/api/auth/logout"),
            ("POST", "/api/auth/logout-all"),
            ("GET", "/api/auth/me"),
            ("PATCH", "/api/auth/password"),
            ("POST", "/api/auth/password-reset"),
            ("POST", "/api/auth/password-reset/confirm"),
            ("POST", "/api/auth/email-verification/request"),
            ("POST", "/api/auth/email-verification/confirm"),
            ("GET", "/api/auth/me/finance"),
            ("PUT", "/api/auth/me/finance"),
            ("POST", "/api/auth/verify-password"),
            ("GET", "/api/auth/sessions"),
            ("PATCH", "/api/auth/me"),
            ("PUT", "/api/auth/me/avatar"),
            ("DELETE", "/api/auth/me/avatar"),
            ("GET", "/api/auth/me/appearance-image"),
            ("POST", "/api/auth/me/appearance-image"),
            ("DELETE", "/api/auth/me/appearance-image"),
            ('GET', '/api/lifestyle/calendar/markers'),
            ('POST', '/api/lifestyle/calendar/markers'),
            ('PUT', '/api/lifestyle/calendar/markers/{marker_key}'),
            ('DELETE', '/api/lifestyle/calendar/markers/{marker_key}'),
            ('GET', '/api/lifestyle/calendar/events'),
            ('POST', '/api/lifestyle/calendar/events'),
            ('PATCH', '/api/lifestyle/calendar/events/{event_id}'),
            ('DELETE', '/api/lifestyle/calendar/events/{event_id}'),
            ('PUT', '/api/lifestyle/calendar/shifts/{day}'),
            ('GET', '/api/lifestyle/calendar/reminders'),
            ('POST', '/api/lifestyle/calendar/reminders/ack'),
            ("GET", "/api/lifestyle/preferences"),
            ("PUT", "/api/lifestyle/preferences"),
            ("GET", "/api/lifestyle/birthdays"),
            ("GET", "/api/lifestyle/health"),
            ("PUT", "/api/lifestyle/health/{entry_date}"),
            ("DELETE", "/api/lifestyle/health/{entry_date}"),
            ("GET", "/api/lifestyle/smoking/settings"),
            ("PUT", "/api/lifestyle/smoking/settings"),
            ("GET", "/api/lifestyle/smoking"),
            ("PUT", "/api/lifestyle/smoking/{entry_date}"),
            ("GET", "/api/lifestyle/jar"),
            ("PUT", "/api/lifestyle/jar"),
            ("PUT", "/api/lifestyle/jar/image"),
            ("GET", "/api/lifestyle/jar/image"),
            ("DELETE", "/api/lifestyle/jar/image"),
            ("GET", "/api/lifestyle/jars"),
            ("POST", "/api/lifestyle/jars"),
            ("PUT", "/api/lifestyle/jars/{jar_id}"),
            ("PUT", "/api/lifestyle/jars/{jar_id}/image"),
            ("GET", "/api/lifestyle/jars/{jar_id}/image"),
            ("GET", "/api/admin/users"),
            ("POST", "/api/admin/users/{user_id}/suspend"),
            ("DELETE", "/api/admin/users/{user_id}/suspend"),
        ],
        files=[
            "app/routers/auth/__init__.py",
            "app/routers/auth/auth.py",
            "app/routers/auth/admin.py",
            "app/models/user.py",
            "app/schemas/auth.py",
            "app/services/email_verification.py",
            "app/routers/appearance.py",
            "app/schemas/appearance.py",
            "app/models/lifestyle.py",
            "app/schemas/lifestyle.py",
            "app/services/lifestyle.py",
            "app/routers/lifestyle.py",
            "app/routers/calendar.py",
            "app/models/calendar.py",
            "app/schemas/calendar.py",
        ],
        shared=[
            "app/services/llm/client.py",
            "app/guards.py",
            "app/cli.py",
            "app/routers/_stub.py",
            "app/models/_types.py",
        ],
    ),
    Member(
        key="m2",
        label="記帳",
        domain="記帳",
        color="#8B7CF0",
        scope=(
            "負責「記一筆帳」這個動作，從文字進來到寫進資料庫。★ 這是整個系統的核心。\n"
            "屬於他的：明細的增刪改查、段落解析、單句解析、確認後寫入、nlp_parses 的寫入。\n"
            "⚠️ 明細的**修改與刪除只有本人可以**，監管者不行——監管是唯讀的。\n"
            "  結算過的帳本裡的紀錄不能改、不能刪（409）。一次刪多筆（DELETE /api/transactions?ids=）全部成功或全部不動。\n"
            "新增一筆時要順手寫一則通知給監管者（家庭 的 notifications 表）。\n"
            "帳本也在這裡：一本帳就是「這筆算在哪」的容器，跟記帳同一個脈絡。\n"
            "常設帳本沒有結束；活動帳本有結束日，到了由建立者手動結算，之後唯讀（不能再記，回 409）。\n"
            "⚠️ 結算**不搬動任何一筆紀錄**，只是把那本帳標記結束。\n"
            "結算過的活動帳本可以封存（可復原）或移除（帳本不見、不能復原，紀錄一筆都不刪）。\n"
            "  規則在 toolkit/ledger.py。\n"
            "⚠️ 帳本成員是可見範圍的其中一條路，但規則不要自己寫——\n"
            "  一律呼叫 toolkit/scope.py，有測試擋著重寫。\n"
            "分類也在這裡：它是記帳時要選的欄位，統計只是拿它分組。\n"
            "活動邀請由建立者發出，受邀本人同意或使用單次邀請碼才加入；不變更家庭與家庭角色。\n"
            "明細年月包裹只統計完整授權範圍的筆數，不移動紀錄或鎖定歷史月份。\n"
            "不屬於他的：統計加總（那是數字，前端和這裡都不做任何加總）。"
        ),
        routes=[
            ("GET", "/api/transactions"),
            ("GET", "/api/transactions/archives"),
            ("POST", "/api/transactions"),
            ("POST", "/api/statement-import/preview"),
            ("POST", "/api/statement-import/confirm"),
            ("GET", "/api/billing/profile"),
            ("PUT", "/api/billing/profile"),
            ("PATCH", "/api/transactions/{tx_id}"),
            ("DELETE", "/api/transactions/{tx_id}"),
            ("DELETE", "/api/transactions"),
            ("POST", "/api/nlp/parse"),
            ("POST", "/api/nlp/parse-batch"),
            ("POST", "/api/nlp/confirm"),
            ("POST", "/api/nlp/confirm-batch"),
            ("GET", "/api/categories"),
            ("POST", "/api/categories"),
            ("GET", "/api/groups"),
            ("POST", "/api/groups"),
            ("PATCH", "/api/groups/{gid}"),
            ("DELETE", "/api/groups/{gid}"),
            ("POST", "/api/groups/{gid}/members"),
            ("DELETE", "/api/groups/{gid}/members/{user_id}"),
            ("POST", "/api/groups/{gid}/settle"),
            ("PATCH", "/api/groups/{gid}/notify"),
            ("GET", "/api/groups/lookup"),
            ("GET", "/api/groups/invites"),
            ("POST", "/api/groups/join"),
            ("POST", "/api/groups/invites/{invite_id}/accept"),
            ("DELETE", "/api/groups/invites/{invite_id}"),
            ("GET", "/api/groups/{gid}/invites"),
            ("POST", "/api/groups/{gid}/invite-codes"),
            ("POST", "/api/groups/{gid}/invites"),
            ("DELETE", "/api/groups/{gid}/invites/{invite_id}"),
            ("GET", "/api/transactions/{transaction_id}/photos"),
            ("POST", "/api/transactions/{transaction_id}/photos"),
            ("GET", "/api/transaction-photos/{photo_id}/image"),
            ("DELETE", "/api/transaction-photos/{photo_id}"),
            ("GET", "/api/memories"),
            ("PATCH", "/api/memories/settings"),
            ("POST", "/api/memories/puzzles"),
            ("GET", "/api/memories/puzzles/{game_id}/image"),
            ("GET", "/api/memories/achievements"),
            ("PUT", "/api/memories/wall-background"),
            ("DELETE", "/api/memories/wall-background"),
            ("GET", "/api/memories/wall-background/image"),
        ],
        files=[
            "app/routers/ledger/__init__.py",
            "app/routers/ledger/transactions.py",
            "app/routers/ledger/statement_import.py",
            "app/schemas/statement_import.py",
            "app/services/statement_import.py",
            "app/models/transaction_details.py",
            "app/routers/ledger/nlp.py",
            "app/routers/ledger/categories.py",
            "app/routers/ledger/groups.py",
            "app/routers/ledger/group_invites.py",
            "app/models/category.py",
            "app/models/group.py",
            "app/schemas/group.py",
            "app/services/evaluation.py",
            "app/models/transaction.py",
            "app/models/nlp.py",
            "app/schemas/transaction.py",
            "app/schemas/nlp.py",
            "app/services/llm/parse.py",
            "app/routers/memories.py",
            "app/models/memories.py",
            "app/schemas/memories.py",
            "app/services/memories.py",
        ],
    ),
    Member(
        key="m3",
        label="數字",
        domain="數字",
        color="#5FB8D9",
        scope=(
            "負責所有「算出來的東西」，以及把那些數字講成人話。\n"
            "屬於他的：月年統計、預算、每月存款目標、階段性提醒的門檻、財務建議。\n"
            "瀏覽器 AI 的唯讀工具提供精確帳務證據與本機教學檢索，不執行模型或建立交易。\n"
            "**整個系統只有這裡加總錢** —— 模型不算，前端只做衍生（結餘、比例、預算百分比）。\n"
            "  GET /api/stats、GET /api/savings-goal 已經拿掉：前端從 summary、savings-goals 自己取。\n"
            "每月存款目標可以**分群組設定**：不帶 groupId 是整體目標，帶了就是那個群組自己的目標。\n"
            "階段性提醒也在這裡：使用者自己設幾個百分比門檻（例如 50%／80%／100%），"
            "支出跨過門檻就發一則通知。\n"
            "⚠️ **算出要發通知是數字，真的寫進 notifications 是家庭。**\n"
            "不屬於他的：明細的寫入（那是記帳）；決定要算哪些人（那是家庭 的 permission）。"
        ),
        routes=[
            ("GET", "/api/summary"),
            ("GET", "/api/budgets"),
            ("PUT", "/api/budgets"),
            ("PUT", "/api/savings-goal"),
            ("GET", "/api/savings-goals"),
            ("GET", "/api/alerts"),
            ("POST", "/api/alerts"),
            ("PATCH", "/api/alerts/{aid}"),
            ("DELETE", "/api/alerts/{aid}"),
            ("GET", "/api/advices"),
            ("POST", "/api/advices/generate"),
            ("GET", "/api/exchange/rates"),
            ("POST", "/api/exchange/convert"),
            ("GET", "/api/ai-local/context"),
            ("GET", "/api/ai-local/knowledge"),
            ("GET", "/api/ai-local/report"),
            ("GET", "/api/ai-local/report/export"),
            ("GET", "/api/monthly-reports/settings"),
            ("PUT", "/api/monthly-reports/settings"),
            ("POST", "/api/monthly-reports/authorize"),
            ("DELETE", "/api/monthly-reports/authorization"),
            ("GET", "/api/monthly-reports/export"),
            ("GET", "/api/resources/anti-fraud"),
            ("GET", "/api/resources/financial"),
        ],
        files=[
            "app/routers/analytics/__init__.py",
            "app/routers/analytics/stats.py",
            "app/routers/analytics/alerts.py",
            "app/models/alert.py",
            "app/routers/analytics/budgets.py",
            "app/routers/analytics/advices.py",
            "app/models/budget.py",
            "app/models/advice.py",
            "app/schemas/stats.py",
            "app/schemas/advice.py",
            "app/services/llm/advice.py",
            "app/routers/resources.py",
            "app/services/public_resources.py",
            "app/routers/analytics/exchange.py",
            "app/schemas/exchange.py",
            "app/services/exchange.py",
            "app/routers/ai_local.py",
            "app/routers/monthly_reports.py",
            "app/services/monthly_report.py",
            "app/models/report_subscription.py",
            "app/schemas/report_subscription.py",
            "app/schemas/ai_local.py",
            "app/services/ai_local.py",
            "app/schemas/report_query.py",
            "app/services/report_query.py",
        ],
        shared=[
            "app/services/analytics.py",
        ],
    ),
    Member(
        key="m4",
        label="家庭",
        domain="家庭",
        color="#6EE7B7",
        scope=(
            "負責「誰在這個家庭裡」以及「誰看得到誰的資料」。\n"
            "屬於他的：家庭、成員角色、家庭綁定（邀請碼與用帳號邀請）、監管關係、權限計算、"
            "唯讀監管檢視與即時通知、零用金、稽核紀錄。\n"
            "家庭綁定：家長建立家庭，用邀請碼或輸入對方 email 邀請家人加入。\n"
            "⚠️ 身分（家長／子女）由發邀請的家長決定，被邀請的人不能自己選。\n"
            "⚠️ 用帳號找人只接受完整 email，不做模糊搜尋，也不回任何財務資料。\n"
            "⚠️ 邀請碼只能用一次、七天過期、資料庫只存雜湊。工具在 toolkit/family.py。\n"
            "移出、退出、解散：家長只能移除子女，另一位家長只能自己退出；唯一的家長在家裡還有人時不能退出，\n"
            "  改用解散（DELETE /api/family，只有唯一的家長能解散）。\n"
            "角色：家長可以把子女設為家長；不能把另一位家長降成子女，只有他自己能調整。\n"
            "監管：家長按「開始照看」建立，監管人一定是自己；監管人或同家的家長可以解除，被照看的人不行。\n"
            "  規則都在 toolkit/family.py。\n"
            "⚠️ 離開不刪紀錄，但監管關係、共用帳本、他送出的邀請要在同一個交易裡一起收掉。\n"
            "⚠️ 監管是**唯讀**的：看得到，但不能改、不能刪，"
            "更不能登入對方的帳號。\n"
            "⚠️ **可見範圍是兩條路的聯集，過一條就看得到**：\n"
            "  A. 這筆是誰記的 → 自己 ＋ 我監管的人 ＋ 同家庭的其他家長，**跨所有帳本**\n"
            "     （家長之間互相看得到；家長看子女一樣要有監管關係）\n"
            "  B. 這筆在哪一本帳 → group_members（我在不在那本帳裡）\n"
            "  A 是監管：不該被帳本切斷，否則被監管的人另開一本帳就躲掉了。\n"
            "  B 是分享：把誰加進帳本，就是選擇讓他看到那一本。\n"
            "⚠️ 寫成 AND 就變回交集了，那是早期版本的錯。規則寫在 toolkit/scope.py。\n"
            "帳本本身（開、改、封存、結算、成員）屬於記帳——那是記帳的容器。\n"
            "家庭 只管**可見範圍怎麼算**，不管帳本的 CRUD。\n"
            "零用金也在這裡：家長每個月給某個被監管者多少錢。\n"
            "⚠️ **零用金是設定，不是一筆支出紀錄。**\n"
            "  家長記一筆「給小孩 3000」，小孩再把那 3000 花掉記成支出，\n"
            "  家庭總支出就會變成 6000——同一筆錢被算了兩次。\n"
            "  正確的算法是：**子女的支出算進家庭支出，子女的收入不算進家庭收入**，\n"
            "  零用金只拿來跟「他實際花了多少」做對照。\n"
            "不屬於他的：登入本身（那是認證）。"
            "認證 回答「你是誰」，家庭 回答「你能看到什麼」。"
        ),
        routes=[
            ("GET", "/api/family"),
            ("POST", "/api/family"),
            ("DELETE", "/api/family"),
            ("POST", "/api/family/invite"),
            ("POST", "/api/family/join"),
            ("GET", "/api/family/lookup"),
            ("GET", "/api/family/invites"),
            ("POST", "/api/family/invites"),
            ("POST", "/api/family/invites/{invite_id}/accept"),
            ("DELETE", "/api/family/invites/{invite_id}"),
            ("PATCH", "/api/family/members/{user_id}"),
            ("DELETE", "/api/family/members/{user_id}"),
            ("GET", "/api/guardianships"),
            ("POST", "/api/guardianships"),
            ("DELETE", "/api/guardianships/{gid}"),
            ("GET", "/api/notifications"),
            ("PATCH", "/api/notifications/{nid}"),
            ("PATCH", "/api/notifications"),
            ("GET", "/api/allowances"),
            ("PUT", "/api/allowance"),
            ("GET", "/api/audit"),
        ],
        files=[
            "app/routers/access/__init__.py",
            "app/routers/access/family.py",
            "app/routers/access/notifications.py",
            "app/models/family.py",
            "app/models/guardianship.py",
            "app/models/notification.py",
            "app/models/audit.py",
            "app/schemas/family.py",
        ],
        shared=[
            "app/services/permission.py",
        ],
    ),
]

# ---------------------------------------------------------------------------
# 不屬於任何一個領域的共用檔案。
# ---------------------------------------------------------------------------
SHARED_FILES: list[str] = [
    "app/main.py",           # 只有 include_router，新增路由組時才會動
    "app/ownership.py",      # 就是這個檔案
    "app/models/__init__.py",
    "app/schemas/__init__.py",
    "app/routers/__init__.py",
    "app/services/__init__.py",
    "app/services/llm/__init__.py",
    "app/toolkit/body_limit.py",
    "app/services/mail_content.py",
    "app/services/appearance.py",
]

# ---------------------------------------------------------------------------
# 誰都不可以實作的路由。前端也沒有，列在這裡是為了讓「為什麼沒有」有地方可查。
# ---------------------------------------------------------------------------
NEVER_IMPLEMENT: list[tuple[str, str]] = [
    (
        "POST /api/auth/switch",
        "**任何一端都不可以實作這支。**\n"
        "前端曾經有一顆「切換身分」的示範鈕，已經連同這支路由一起拿掉了，"
        "換成真正的登入／登出。\n"
        "這不只是安全問題，更是產品決定：**管理者不可以進入子女的帳號**。\n"
        "監管的正當性建立在「看得到但碰不到」——能登入對方帳號的話，"
        "被監管者就無法信任自己的紀錄沒有被動過手腳。\n"
        "管理者要看子女的資料，走**唯讀的監管檢視**"
        "（帶 userId 查明細），不是換身分。\n"
        "列在這裡是為了讓「為什麼沒有這個功能」有地方可查——"
        "不然過幾週就會有人「順手補上」。",
    ),
]

# 舊名字。曾經的語意是「前端有、後端不用做」，
# 現在前端也沒有了，所以改叫 NEVER_IMPLEMENT。
FRONTEND_ONLY = NEVER_IMPLEMENT


# ---------------------------------------------------------------------------
# 系統路由，由應用健康檢查或 FastAPI 文件功能提供。
# ---------------------------------------------------------------------------
SYSTEM_ROUTES: list[tuple[str, str]] = [
    ("GET", "/healthz"),          # 我們寫的，給 Render 做健康檢查
    ("GET", "/readyz"),           # 資料庫與初始化就緒檢查
    ("GET", "/capabilities"),     # 可選模型／郵件設定狀態（不回傳機密）
    # 下面四支是 FastAPI 自己掛的，我們一行都沒寫
    ("GET", "/docs"),             # 互動式 API 文件
    ("GET", "/docs/oauth2-redirect"),
    ("GET", "/redoc"),            # 另一種版型的文件
    ("GET", "/openapi.json"),     # 規格本體，上面兩頁都是讀它畫出來的
]


def owner_of(method: str, path: str) -> Member | None:
    """查詢路由的功能領域。"""
    for m in MEMBERS:
        if (method.upper(), path) in m.routes:
            return m
    return None


def all_routes() -> dict[tuple[str, str], Member]:
    """全部業務路由。鍵是 (方法, 路徑)。"""
    out: dict[tuple[str, str], Member] = {}
    for m in MEMBERS:
        for r in m.routes:
            if r in out:
                raise ValueError(
                    f"路由 {r[0]} {r[1]} 同時被 {out[r].label} 和 {m.label} 宣告"
                )
            out[r] = m
    return out


def progress() -> dict[str, dict]:
    """
    比對目錄與實際掛載的路由，回傳每個功能領域的覆蓋情況。

    回傳
        dict: 鍵是領域代號，值是
            `{"done": [...], "todo": [...], "member": Member}`。

    注意
        **路由還沒寫不算錯誤**，那是正常的進度。
        此結果用於維護 API 目錄的一致性。
    """
    from app.main import app  # 延後匯入，避免循環相依
    from app.routers._stub import is_stub

    actual: set[tuple[str, str]] = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if not methods or not path:
            continue
        # 掛上去但還是 @stub（回 501）的，算還沒做
        if is_stub(getattr(route, "endpoint", None)):
            continue
        for verb in methods:
            if verb not in ("HEAD", "OPTIONS"):
                actual.add((verb, path))

    out = {}
    for m in MEMBERS:
        done = [r for r in m.routes if r in actual]
        todo = [r for r in m.routes if r not in actual]
        out[m.key] = {"member": m, "done": done, "todo": todo}
    return out


def check() -> list[str]:
    """
    檢查領域目錄是否重複，以及實際路由是否都已登記。

    回傳
        list[str]: 所有問題。空清單代表沒問題。

    注意
        **不檢查「宣告了但還沒寫」** —— 那是進度不是錯誤，用 progress() 看。
        此檢查會找出路由／檔案的重複登記及漏登。
    """
    from app.main import app

    problems: list[str] = []
    declared = all_routes()

    actual: set[tuple[str, str]] = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if not methods or not path:
            continue
        for verb in methods:
            if verb not in ("HEAD", "OPTIONS"):
                actual.add((verb, path))

    for key in sorted(actual - set(declared) - set(SYSTEM_ROUTES)):
        problems.append(
            f"實際路由尚未登記：{key[0]} {key[1]}"
            "（在 ownership.py 的 MEMBERS 裡加上去）"
        )

    seen: dict[str, str] = {}
    for m in MEMBERS:
        for f in m.files + m.shared:
            if f in seen:
                problems.append(f"檔案 {f} 同時屬於 {seen[f]} 和 {m.label}")
            seen[f] = m.label

    return problems


def main() -> int:
    # Windows 主控台預設 cp950，印不出某些字元會整個爆掉
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    total = sum(len(m.routes) for m in MEMBERS)
    print("=" * 70)
    print("各領域的完成度　（app/ownership.py 是唯一的事實來源）")
    print("=" * 70)

    prog = progress()
    all_done = 0
    for m in MEMBERS:
        p = prog[m.key]
        d, t = len(p["done"]), len(p["todo"])
        all_done += d
        bar = "█" * d + "░" * t
        print(f"\n{m.label}")
        print(f"  {bar}  {d}/{d + t} 支")
        print(f"  {m.scope.splitlines()[0]}")
        if m.shared:
            print(f"  [共用元件] {', '.join(m.shared)}")
        if t and t <= 12:
            print(f"  還沒寫：{', '.join(f'{v} {p2}' for v, p2 in p['todo'])}")

    print("\n" + "-" * 70)
    print(f"總進度　{all_done}/{total} 支　"
          f"({all_done * 100 // total if total else 0}%)")

    print("\n" + "=" * 70)
    problems = check()
    if problems:
        print(f"❌ 找到 {len(problems)} 個問題：")
        for p in problems:
            print("   -", p)
        return 1
    print("✅ 領域定義沒有矛盾")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
