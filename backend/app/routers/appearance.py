"""Private account background photo, stored in the same persistent database as the account.

領域：認證
"""

import base64
import binascii
from io import BytesIO
import warnings

from fastapi import APIRouter, Depends, HTTPException, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.guards import current_user
from app.models import User
from app.schemas.appearance import AppearanceImageIn
from app.services.appearance import touch_preferences
from app.toolkit.db import get_db

router = APIRouter(tags=["個人設定"])
OWNER = "認證"


def normalize_background(value):
    """Decode actual raster pixels, orient and resize; reject SVG and disguised files."""
    try:
        prefix, data = value.split(",", 1)
        if prefix.lower() not in {"data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"}:
            raise ValueError
        raw = base64.b64decode(data, validate=True)
        if not raw or len(raw) > 5_500_000:
            raise ValueError
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"} or source.width * source.height > 40_000_000:
                    raise ValueError
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1920, 1920))
                result = BytesIO()
                image.save(result, format="JPEG", quality=86, optimize=True)
                return result.getvalue()
    except (ValueError, binascii.Error, UnidentifiedImageError, OSError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "背景照片無法讀取，請選擇 JPEG、PNG 或 WebP 圖片再試一次") from None


@router.get("/auth/me/appearance-image", summary="讀取自己的同步背景照片", response_class=Response,
            responses={200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}}})
def get_background(me: User = Depends(current_user)):
    """讀取自己的同步背景照片

    需有效登入，只讀取目前帳號的背景，回傳 JPEG 二進位內容並禁止快取。
    尚未設定照片回 404；未登入或工作階段失效回 401。
    """
    if not me.appearance_photo_bytes:
        raise HTTPException(404, "尚未設定背景照片")
    return Response(me.appearance_photo_bytes, media_type=me.appearance_photo_mime or "image/jpeg",
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/auth/me/appearance-image", summary="同步自己的背景照片")
def save_background(body: AppearanceImageIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """同步自己的背景照片

    需有效登入；JSON dataUrl 接受 JPEG、PNG 或 WebP，解碼後縮至最長邊 1920 像素。
    照片持久保存於目前帳號的資料庫，並更新 appearance.updatedAt 供其他裝置同步。
    回傳照片 URL 與 appearanceUpdatedAt；無法解碼、超過大小或像素限制回 422。
    """
    me.appearance_photo_bytes = normalize_background(body.dataUrl)
    me.appearance_photo_mime = "image/jpeg"
    version = touch_preferences(me)
    db.commit()
    return {"url": "/api/auth/me/appearance-image", "appearanceUpdatedAt": version}


@router.delete("/auth/me/appearance-image", summary="清除自己的同步背景照片")
def delete_background(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """清除自己的同步背景照片

    需有效登入，只移除目前帳號的照片並更新同步時間；保留其他外觀設定。
    已無照片時仍回 {"ok": true}，重複操作不會影響其他帳號。
    """
    me.appearance_photo_bytes = None
    me.appearance_photo_mime = None
    touch_preferences(me)
    db.commit()
    return {"ok": True}
