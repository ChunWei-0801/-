"""Server-owned photo validation, earned puzzle pieces and immutable memories.

領域：照片與小天地
"""

from __future__ import annotations

import hashlib
import io
import warnings
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from app.models.memories import PuzzleEarning, PuzzleGame, PuzzleSettings
from app.models._types import utcnow
from app.toolkit import errors

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PHOTOS_PER_TRANSACTION = 4
MAX_IMAGE_PIXELS = 40_000_000
MAX_STORED_EDGE = 1920
ALLOWED_PIECES = (9, 16, 25, 36, 64, 100)


def utc_iso(value: datetime) -> str:
    # SQLite returns naive values for a TIMESTAMPTZ column; those stored values
    # are still UTC. Always label the offset for correct international display.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def normalize_photo(data: bytes) -> tuple[bytes, str, int, int]:
    """Actually decode JPEG/PNG/WebP, orient, strip EXIF, and store a view copy."""
    if not data:
        raise errors.unprocessable("請選擇一張照片")
    if len(data) > MAX_UPLOAD_BYTES:
        raise errors.unprocessable("上傳版本需小於 20 MB，請先縮小照片後重試")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"}:
                    raise errors.unprocessable("請使用 JPEG、PNG 或 WebP 照片")
                if original.width * original.height > MAX_IMAGE_PIXELS:
                    raise errors.unprocessable("照片解析度太高，請先縮小為 4,000 萬畫素以下")
                original.verify()
            with Image.open(io.BytesIO(data)) as original:
                oriented = ImageOps.exif_transpose(original)
                oriented.thumbnail((MAX_STORED_EDGE, MAX_STORED_EDGE), Image.Resampling.LANCZOS)
                if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                    rgba = oriented.convert("RGBA")
                    image = Image.new("RGB", rgba.size, "white")
                    image.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    image = oriented.convert("RGB")
                image.load()
                output = io.BytesIO()
                image.save(output, "JPEG", quality=88, optimize=True)
                return output.getvalue(), "image/jpeg", image.width, image.height
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise errors.unprocessable("無法讀取這張照片，請改用有效的 JPEG、PNG 或 WebP") from None


def settings_for(db: Session, user_id: int) -> PuzzleSettings:
    """The user row serializes first activation; the settings row serializes play."""
    from app.models.user import User
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).first()
    settings = db.execute(select(PuzzleSettings).where(PuzzleSettings.user_id == user_id).with_for_update()).scalar_one_or_none()
    if settings is None:
        settings = PuzzleSettings(user_id=user_id)
        db.add(settings)
        db.flush()
    return settings


def award_transaction_piece(connection, transaction) -> None:
    """One confirmed transaction, one reward; edits and retries never add more.

    Every new transaction qualifies, including those before the first visit to
    the memories screen. Migrations do not backfill existing records. Deleted
    transactions leave tombstones. Recreating the same financial record
    reconnects its tombstone instead of minting another reward.
    """
    settings = PuzzleSettings.__table__
    if connection.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as dialect_insert
    else:
        from sqlalchemy.dialects.sqlite import insert as dialect_insert
    connection.execute(dialect_insert(settings).values(user_id=transaction.user_id)
                       .on_conflict_do_nothing(index_elements=[settings.c.user_id]))
    connection.execute(select(settings.c.user_id).where(settings.c.user_id == transaction.user_id).with_for_update()).first()
    fingerprint = transaction_fingerprint(transaction)
    earnings = PuzzleEarning.__table__
    old = connection.execute(select(earnings.c.id).where(
        earnings.c.user_id == transaction.user_id,
        earnings.c.fingerprint == fingerprint,
        earnings.c.transaction_id.is_(None),
    ).order_by(earnings.c.earned_at, earnings.c.id).limit(1)).first()
    if old is not None:
        connection.execute(update(earnings).where(earnings.c.id == old.id).values(transaction_id=transaction.id))
        _allocate_on_connection(connection, transaction.user_id)
        return
    connection.execute(insert(earnings).values(
        id=str(uuid4()), user_id=transaction.user_id, transaction_id=transaction.id,
        fingerprint=fingerprint, game_id=None, earned_at=utcnow(),
    ))
    _allocate_on_connection(connection, transaction.user_id)


def _allocate_on_connection(connection, user_id: int) -> None:
    """Complete a puzzle in the final ledger write, even if its UI is closed.

    This shares the settings lock and transaction of the reward insertion, so
    completion time is the final actual entry time, not the next screen visit.
    """
    games, earnings = PuzzleGame.__table__, PuzzleEarning.__table__
    game = connection.execute(select(games.c.id, games.c.piece_count, games.c.completed_at,
                                     games.c.timezone).where(games.c.user_id == user_id)
                              .order_by(games.c.created_at.desc(), games.c.id.desc()).limit(1)
                              .with_for_update()).first()
    if game is None or game.completed_at is not None:
        return
    # Deleted records have no active piece. Release their provisional slots
    # before refilling so a later restoration can still earn its original
    # piece, rather than becoming trapped in a board that has since completed.
    connection.execute(update(earnings).where(
        earnings.c.game_id == game.id, earnings.c.transaction_id.is_(None),
    ).values(game_id=None))
    # Lock awarded rows as well as the board. A concurrent ledger deletion
    # must happen before our count or after completion commits; otherwise it
    # could erase an entry between counting the last piece and saving the wall.
    assigned = len(list(connection.scalars(select(earnings.c.id).where(
        earnings.c.game_id == game.id, earnings.c.transaction_id.is_not(None),
    ).with_for_update())))
    missing = max(0, game.piece_count - assigned)
    if missing:
        bank = list(connection.scalars(select(earnings.c.id).where(
            earnings.c.user_id == user_id, earnings.c.game_id.is_(None), earnings.c.transaction_id.is_not(None))
            .order_by(earnings.c.earned_at, earnings.c.id).limit(missing).with_for_update()))
        if bank:
            connection.execute(update(earnings).where(earnings.c.id.in_(bank)).values(game_id=game.id))
            assigned += len(bank)
    values = {"earned_pieces": min(assigned, game.piece_count)}
    if assigned >= game.piece_count:
        completed_at = utcnow()
        local = completed_at.astimezone(ZoneInfo(game.timezone))
        values.update(completed_at=completed_at, year=local.year, month=local.month)
    connection.execute(update(games).where(games.c.id == game.id).values(**values))


def transaction_fingerprint(transaction) -> str:
    return hashlib.sha256("\x1f".join(str(item) for item in (
        transaction.user_id, transaction.group_id, transaction.kind,
        transaction.occurred_on.isoformat(), format(transaction.amount, ".2f"),
        (transaction.merchant or "").strip(), (transaction.note or "").strip(),
    )).encode("utf-8")).hexdigest()


def update_transaction_fingerprint(connection, transaction) -> None:
    # Editing a record never earns another piece. Retain its current identity
    # so edit -> delete -> recreate cannot evade the deleted-record tombstone.
    table = PuzzleEarning.__table__
    connection.execute(update(table).where(table.c.transaction_id == transaction.id)
                       .values(fingerprint=transaction_fingerprint(transaction)))


def period_info(settings: PuzzleSettings, now: datetime | None = None) -> tuple[str, datetime, datetime]:
    local = (now or utcnow()).astimezone(ZoneInfo(settings.timezone))
    if settings.period == "week":
        start = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
        year, week, _day = local.isocalendar()
        key = f"{year}-W{week:02d}"
    else:
        start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        key = start.strftime("%Y-%m")
    return key, start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def current_game(db: Session, user_id: int) -> PuzzleGame | None:
    return db.execute(select(PuzzleGame).where(PuzzleGame.user_id == user_id).order_by(
        PuzzleGame.created_at.desc(), PuzzleGame.id.desc()).limit(1)).scalar_one_or_none()


def allocate_pieces(db: Session, game: PuzzleGame | None) -> None:
    """Called under the owner's settings lock; achievements never change."""
    if game is None or game.completed_at is not None:
        return
    db.execute(update(PuzzleEarning).where(
        PuzzleEarning.game_id == game.id, PuzzleEarning.transaction_id.is_(None),
    ).values(game_id=None))
    assigned = len(db.scalars(select(PuzzleEarning.id).where(
        PuzzleEarning.game_id == game.id, PuzzleEarning.transaction_id.is_not(None),
    ).with_for_update()).all())
    needed = max(0, game.piece_count - assigned)
    if needed:
        bank = db.execute(select(PuzzleEarning).where(
            PuzzleEarning.user_id == game.user_id, PuzzleEarning.game_id.is_(None),
            PuzzleEarning.transaction_id.is_not(None),
        ).order_by(PuzzleEarning.earned_at, PuzzleEarning.id).limit(needed).with_for_update()).scalars().all()
        for earning in bank:
            earning.game_id = game.id
        assigned += len(bank)
    game.earned_pieces = min(assigned, game.piece_count)
    if game.earned_pieces == game.piece_count:
        game.completed_at = utcnow()
        # Index the achievement by completion date, in the puzzle's own zone.
        completed = game.completed_at.astimezone(ZoneInfo(game.timezone))
        game.year, game.month = completed.year, completed.month
    db.flush()


def game_dict(game: PuzzleGame) -> dict:
    return {
        "id": game.id, "pieceCount": game.piece_count,
        "earnedPieces": game.earned_pieces, "completed": game.completed_at is not None,
        "createdAt": utc_iso(game.created_at),
        "completedAt": utc_iso(game.completed_at) if game.completed_at else None,
        "imageUrl": f"/api/memories/puzzles/{game.id}/image",
        "period": game.period, "periodKey": game.period_key,
        "timezone": game.timezone, "year": game.year, "month": game.month,
        "width": game.width, "height": game.height,
    }


def settings_dict(settings: PuzzleSettings) -> dict:
    return {
        "wallName": settings.wall_name, "period": settings.period,
        "timezone": settings.timezone, "pieceCount": settings.piece_count,
        "changesPerPeriod": settings.changes_per_period,
        "activatedAt": utc_iso(settings.activated_at),
        "wallBackgroundUrl": "/api/memories/wall-background/image" if settings.wall_background_data else None,
    }


def state(db: Session, settings: PuzzleSettings) -> dict:
    game = current_game(db, settings.user_id)
    allocate_pieces(db, game)
    key, start, end = period_info(settings)
    started = db.scalar(select(func.count()).select_from(PuzzleGame).where(
        PuzzleGame.user_id == settings.user_id, PuzzleGame.created_at >= start,
        PuzzleGame.created_at < end)) or 0
    bank = db.scalar(select(func.count()).select_from(PuzzleEarning).where(
        PuzzleEarning.user_id == settings.user_id, PuzzleEarning.game_id.is_(None),
        PuzzleEarning.transaction_id.is_not(None))) or 0
    total = db.scalar(select(func.count()).select_from(PuzzleEarning).where(PuzzleEarning.user_id == settings.user_id)) or 0
    return {
        "settings": settings_dict(settings), "current": game_dict(game) if game else None,
        "creditsAvailable": bank, "totalEarned": total,
        "period": {"key": key, "timezone": settings.timezone, "startedCount": started,
                   "remaining": max(0, settings.changes_per_period - started), "nextChangeAt": end.isoformat()},
        "limits": {"maxUploadBytes": MAX_UPLOAD_BYTES, "maxPhotosPerTransaction": MAX_PHOTOS_PER_TRANSACTION,
                   "maxStoredEdge": MAX_STORED_EDGE, "pieceCounts": list(ALLOWED_PIECES)},
    }
