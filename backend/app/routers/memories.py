"""Private purchase photos, earned puzzles, and the owner's achievement wall.

領域：照片與小天地
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.guards import guard, visible_scope
from app.models import Transaction, User
from app.models.memories import PuzzleGame, PuzzleSettings, TransactionPhoto
from app.schemas.memories import PuzzleSettingsIn
from app.services import memories as service
from app.toolkit import errors
from app.toolkit.db import get_db
from app.models._types import utcnow

router = APIRouter(tags=["照片與小天地"])
member = guard(platform_admin=False)


def _transaction(db: Session, me: User, transaction_id: int, *, write=False) -> Transaction:
    query = select(Transaction).where(Transaction.id == transaction_id)
    if write:
        query = query.with_for_update()
    transaction = db.execute(query).scalar_one_or_none()
    if transaction is None:
        raise errors.not_found("找不到這筆紀錄")
    if write:
        if transaction.user_id != me.id:
            raise errors.forbidden("只能管理自己紀錄的照片")
    else:
        users, groups = visible_scope(me, db)
        if transaction.user_id not in users and transaction.group_id not in groups:
            raise errors.forbidden("你沒有權限看這筆紀錄的照片")
    return transaction


def _photo_dict(photo: TransactionPhoto) -> dict:
    return {
        "id": str(photo.id), "transactionId": str(photo.transaction_id),
        "createdAt": service.utc_iso(photo.created_at), "width": photo.width, "height": photo.height,
        "url": f"/api/transaction-photos/{photo.id}/image",
    }


def _read_photo(file: UploadFile):
    return service.normalize_photo(file.file.read(service.MAX_UPLOAD_BYTES + 1))


def _image(data: bytes, mime: str) -> Response:
    return Response(data, media_type=mime, headers={
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
    })


@router.get("/transactions/{transaction_id}/photos", summary="紀錄的回憶照片")
def list_photos(transaction_id: int, me: User = Depends(member), db: Session = Depends(get_db)):
    """紀錄的回憶照片

    List stored photo metadata only after checking the ledger's visibility scope.
    """
    _transaction(db, me, transaction_id)
    photos = db.execute(select(TransactionPhoto).where(TransactionPhoto.transaction_id == transaction_id)
                        .order_by(TransactionPhoto.created_at, TransactionPhoto.id)).scalars().all()
    return {"photos": [_photo_dict(photo) for photo in photos],
            "maxPhotos": service.MAX_PHOTOS_PER_TRANSACTION, "maxUploadBytes": service.MAX_UPLOAD_BYTES}


@router.post("/transactions/{transaction_id}/photos", status_code=201, summary="拍照或加入購買照片")
def upload_photo(transaction_id: int, file: UploadFile = File(...), me: User = Depends(member), db: Session = Depends(get_db)):
    """拍照或加入購買照片

    Store an owner's decoded, oriented photo; serialize uploads to enforce the four-photo limit.
    """
    transaction = _transaction(db, me, transaction_id, write=True)
    count = db.scalar(select(func.count()).select_from(TransactionPhoto).where(TransactionPhoto.transaction_id == transaction_id)) or 0
    if count >= service.MAX_PHOTOS_PER_TRANSACTION:
        raise errors.conflict("每筆紀錄最多保存 4 張照片，請先刪除一張")
    data, mime, width, height = _read_photo(file)
    photo = TransactionPhoto(transaction_id=transaction.id, user_id=me.id, image_data=data,
                             image_mime=mime, width=width, height=height)
    db.add(photo)
    db.flush()
    out = _photo_dict(photo)
    db.commit()
    return out


@router.get("/transaction-photos/{photo_id}/image", summary="查看紀錄照片")
def photo_image(photo_id: int, me: User = Depends(member), db: Session = Depends(get_db)):
    """查看紀錄照片

    Read a private photo using the transaction's current household and ledger permissions.
    """
    photo = db.get(TransactionPhoto, photo_id)
    if photo is None:
        raise errors.not_found("找不到這張照片")
    _transaction(db, me, photo.transaction_id)
    return _image(photo.image_data, photo.image_mime)


@router.delete("/transaction-photos/{photo_id}", summary="移除自己的紀錄照片")
def delete_photo(photo_id: int, me: User = Depends(member), db: Session = Depends(get_db)):
    """移除自己的紀錄照片

    Permanently remove a stored photo after confirming ownership of its transaction.
    """
    photo = db.get(TransactionPhoto, photo_id)
    if photo is None:
        raise errors.not_found("找不到這張照片")
    _transaction(db, me, photo.transaction_id, write=True)
    db.delete(photo)
    db.commit()
    return {"deleted": str(photo_id)}


@router.get("/memories", summary="小天地與拼圖進度")
def get_memories(me: User = Depends(member), db: Session = Depends(get_db)):
    """小天地與拼圖進度

    Every new transaction earns a piece; pre-migration records are not backfilled.
    """
    settings = service.settings_for(db, me.id)
    out = service.state(db, settings)
    db.commit()
    return out


@router.patch("/memories/settings", summary="設定拼圖與成就牆")
def update_settings(body: PuzzleSettingsIn, me: User = Depends(member), db: Session = Depends(get_db)):
    """設定拼圖與成就牆

    Update wall preferences and the next puzzle's cadence, timezone, pieces, and image allowance.
    """
    settings = service.settings_for(db, me.id)
    names = {"wallName": "wall_name", "period": "period", "timezone": "timezone",
             "pieceCount": "piece_count", "changesPerPeriod": "changes_per_period"}
    for name, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            raise errors.unprocessable("設定值不能為空")
        setattr(settings, names[name], value)
    db.flush()
    out = service.state(db, settings)
    db.commit()
    return out


@router.post("/memories/puzzles", status_code=201, summary="選照片開始下一幅拼圖")
def start_puzzle(file: UploadFile = File(...), me: User = Depends(member), db: Session = Depends(get_db)):
    """選照片開始下一幅拼圖

    Start a photo puzzle when the previous one is complete and the current period has room.
    """
    settings = service.settings_for(db, me.id)
    current = service.current_game(db, me.id)
    service.allocate_pieces(db, current)
    if current is not None and current.completed_at is None:
        raise errors.conflict("請先完成目前的拼圖，跨週或跨月也需要完成後才能換圖")
    key, period_start, period_end = service.period_info(settings)
    # Count all games started in this interval, including games whose cadence
    # preference differed. Toggling week/month cannot reset the period counter.
    started = db.scalar(select(func.count()).select_from(PuzzleGame).where(
        PuzzleGame.user_id == me.id, PuzzleGame.created_at >= period_start,
        PuzzleGame.created_at < period_end)) or 0
    if started >= settings.changes_per_period:
        raise errors.conflict("本期可建立的拼圖次數已用完，請等待下一期或調整每期次數")
    data, mime, width, height = _read_photo(file)
    now = utcnow()
    local = now.astimezone(service.ZoneInfo(settings.timezone))
    game = PuzzleGame(user_id=me.id, piece_count=settings.piece_count, earned_pieces=0,
                      image_data=data, image_mime=mime, width=width, height=height,
                      period=settings.period, period_key=key, timezone=settings.timezone,
                      year=local.year, month=local.month, created_at=now)
    db.add(game)
    db.flush()
    out = service.state(db, settings)
    db.commit()
    return out


@router.get("/memories/puzzles/{game_id}/image", summary="拼圖及永久成就照片")
def puzzle_image(game_id: str, me: User = Depends(member), db: Session = Depends(get_db)):
    """拼圖及永久成就照片

    Return the owner's private puzzle photograph, including permanently completed achievements.
    """
    game = db.execute(select(PuzzleGame).where(PuzzleGame.id == game_id, PuzzleGame.user_id == me.id)).scalar_one_or_none()
    if game is None:
        raise errors.not_found("找不到這幅拼圖")
    return _image(game.image_data, game.image_mime)


@router.get("/memories/achievements", summary="依年月查看成就牆")
def achievements(year: int | None = Query(None, ge=2000, le=9999),
                 month: int | None = Query(None, ge=1, le=12), page: int = Query(1, ge=1),
                 me: User = Depends(member), db: Session = Depends(get_db)):
    """依年月查看成就牆

    Page through completed puzzles by completion year/month in each puzzle's chosen timezone.
    """
    settings = service.settings_for(db, me.id)
    service.allocate_pieces(db, service.current_game(db, me.id))
    query = select(PuzzleGame).where(PuzzleGame.user_id == me.id, PuzzleGame.completed_at.is_not(None))
    if year is not None:
        query = query.where(PuzzleGame.year == year)
    if month is not None:
        query = query.where(PuzzleGame.month == month)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    games = db.execute(query.order_by(PuzzleGame.completed_at.desc(), PuzzleGame.id.desc())
                       .offset((page - 1) * 50).limit(50)).scalars().all()
    years = db.scalars(select(PuzzleGame.year).where(PuzzleGame.user_id == me.id, PuzzleGame.completed_at.is_not(None))
                       .distinct().order_by(PuzzleGame.year.desc())).all()
    out = {"achievements": [service.game_dict(game) for game in games], "years": years, "total": total, "page": page, "pageSize": 50}
    db.commit()
    return out


@router.put("/memories/wall-background", summary="設定成就牆背景照片")
def set_wall_background(file: UploadFile = File(...), me: User = Depends(member), db: Session = Depends(get_db)):
    """設定成就牆背景照片

    Normalize a custom photograph and save it privately as the owner's achievement-wall background.
    """
    settings = service.settings_for(db, me.id)
    data, mime, _width, _height = _read_photo(file)
    settings.wall_background_data, settings.wall_background_mime = data, mime
    out = service.settings_dict(settings)
    db.commit()
    return {"settings": out}


@router.delete("/memories/wall-background", summary="移除成就牆背景照片")
def clear_wall_background(me: User = Depends(member), db: Session = Depends(get_db)):
    """移除成就牆背景照片

    Remove the owner's custom wall background while retaining all completed puzzle images.
    """
    settings = service.settings_for(db, me.id)
    settings.wall_background_data = settings.wall_background_mime = None
    db.commit()
    return {"settings": service.settings_dict(settings)}


@router.get("/memories/wall-background/image", summary="自己的成就牆背景")
def wall_background(me: User = Depends(member), db: Session = Depends(get_db)):
    """自己的成就牆背景

    Return only the signed-in owner's current background photograph with private cache headers.
    """
    settings = db.get(PuzzleSettings, me.id)
    if settings is None or settings.wall_background_data is None:
        raise errors.not_found("尚未設定成就牆背景")
    return _image(settings.wall_background_data, settings.wall_background_mime or "image/jpeg")
