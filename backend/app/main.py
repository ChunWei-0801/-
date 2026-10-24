"""
家庭記帳後端入口（API + 同源靜態前端）。

74 支業務接口由 routers.ALL 組裝，輸入使用 Pydantic 驗證，資料存於
SQLAlchemy / PostgreSQL 或展示用 SQLite。啟動之前由 Alembic 遷移和
app.cli init-db 初始化分類，run.py 會實際驗證 /readyz 再宣告就緒。

/healthz：程式存活；/readyz：資料庫與分類已就緒；
/capabilities：模型與郵件整合的設定狀態，不包含機密。
/docs：Swagger API 文件；/docs/index.html：中文專題手冊。

本機從專案根目錄執行 python run.py（PostgreSQL），或
python run.py --sqlite（免 Docker 的持久化展示資料庫）。
"""

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.toolkit.config import settings
from app.toolkit.body_limit import APIBodyLimit

from app import routers
from app.toolkit import db
from app.services.public_resources import start_warmup as warm_public_resources

app = FastAPI(
    title="家庭記帳與財務控管系統 API",
    description=(
        "家庭記帳：認證、自然語言確認入帳、月年統計、預算與家庭權限。\n\n"
        "API 契約見 `docs/02-前後端串接契約.md`；"
        "發表與操作教學見前端 `/docs/index.html`。\n\n"
        "未設定模型時，模型接口回 503，畫面提供明確標示的規則解析備援。"
    ),
    version="1.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# ===========================================================================
# CORS：瀏覽器的安全機制，一定要設對，不然前端會收到看不懂的錯誤
# ===========================================================================
# 瀏覽器規定：網頁 A 的 JavaScript 要去打網站 B 的 API，
# 網站 B 必須明講「我允許 A 來打我」，否則瀏覽器會直接擋下來。
#
# 我們的前端在 fambudget-web.onrender.com，後端在另一個網域，所以一定要設。
#
# 最常見的卡關：前端 console 出現 "blocked by CORS policy"，
# 九成是 ALLOWED_ORIGINS 沒填對 —— 網址要完整（含 https://），結尾不要加斜線。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(APIBodyLimit)


@app.middleware("http")
async def private_response_headers(request: Request, call_next):
    path = request.url.path
    is_api = path == "/api" or path.startswith("/api/")
    if settings.maintenance_mode and is_api:
        # GET handlers and authentication guards can update lazy preferences or
        # session timestamps. Freeze the whole business API before routing,
        # dependencies, body parsing or any database/mail side effect.
        response = JSONResponse(
            status_code=503,
            content={"detail": "系統正在搬移資料，請稍後再試。", "code": "MAINTENANCE_MODE"},
            headers={"Retry-After": "60", "X-FamBudget-Maintenance": "1"},
        )
    else:
        response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if is_api or path in {"/capabilities", "/readyz"}:
        # Account tokens, ledger entries and private photos must not survive
        # in browser/shared HTTP caches after logout or on a shared device.
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers["Pragma"] = "no-cache"
    return response


# ===========================================================================
# 沒接住的錯誤：一律回 JSON 的 500
# ===========================================================================
# 前端只會讀 {"detail": ...}；回純文字的話，畫面只能寫「HTTP 500」。
# ⚠️ 正式環境（APP_ENV=production）只回一句話——例外訊息可能帶著表名、欄位、SQL，
#    那些是攻擊者不需要知道的事（見 toolkit/errors.py 的 safe_message）。
#    開發環境多附上例外的類型與訊息，組員才知道錯在哪；完整的追蹤一律寫進 log。
log = logging.getLogger("fambudget")


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    log.exception("未預期的錯誤：%s %s", request.method, request.url.path)
    detail = "系統發生錯誤，請稍後再試"
    if not settings.is_production:
        detail += "（開發環境才看得到：%s: %s）" % (type(exc).__name__, exc)
    return JSONResponse(status_code=500, content={"detail": detail})


# ---------------------------------------------------------------------------
# 路由：12 組全部掛上，prefix 一律 /api（每個檔案裡寫的是 /api 後面那段）。
# 業務接口已實作；缺少外部模型時回 503，由前端標示規則備援。
# ---------------------------------------------------------------------------
for module in routers.ALL:
    app.include_router(module.router, prefix="/api")

# Only public government data is warmed, in a bounded daemon thread. Readiness
# and account/database initialization never wait for an external information feed.
app.router.add_event_handler("startup", warm_public_resources)


@app.get("/healthz", tags=["系統"])
async def healthz() -> dict[str, str]:
    """
    健康檢查。

    Render 固定打這支確認服務還活著，連續失敗會判定掛掉並重啟。

    這支刻意做得很單純 —— **不查資料庫、不呼叫模型**。
    它的任務只是回答「這個程式還在跑嗎」。
    把資料庫查詢寫進來的話，資料庫一慢就會被誤判成服務掛掉。
    """
    return {"status": "ok", "service": "fambudget-backend"}


@app.get("/readyz", tags=["系統"])
def readyz():
    """Readiness（就緒檢查）：驗證資料庫與必要分類已初始化，不呼叫外部模型。"""
    if settings.maintenance_mode:
        return JSONResponse(status_code=503, content={"status": "maintenance", "database": "not_checked"},
                            headers={"Retry-After": "60", "X-FamBudget-Maintenance": "1"})
    try:
        from app.models import Category
        from sqlalchemy import select
        with db.SessionLocal() as session:
            session.execute(text("SELECT 1"))
            if session.execute(select(Category.id).limit(1)).first() is None:
                return JSONResponse(status_code=503, content={"status": "not_ready", "database": "uninitialized"})
        return {"status": "ready", "database": "ok"}
    except Exception:
        log.exception("資料庫就緒檢查失敗")
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "unavailable"})


@app.get("/capabilities", tags=["系統"])
def capabilities() -> dict:
    """Report optional integrations without exposing credentials or connection URLs."""
    return {
        "maintenance_mode": settings.maintenance_mode,
        "database_provider": settings.database_provider,
        "database_identity_sha256": settings.database_identity_sha256,
        "model_configured": bool(settings.model_base_url),
        "mail_configured": bool(settings.brevo_api_key and settings.mail_from),
        "email_verification_required": settings.email_verification_required,
        "email_delivery_mode": (
            "email" if settings.brevo_api_key and settings.mail_from
            else "unavailable" if settings.is_production else "demo"
        ),
        "fallback": "frontend-rules",
        "training_verified": False,
    }


# 同源部署：API 與靜態前端共用一個服務，免填其他人的後端網址。
# API 路由必須先註冊；/docs 為 Swagger，/docs/index.html 為使用者手冊。
frontend = Path(__file__).resolve().parents[2] / "frontend"
if frontend.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")
