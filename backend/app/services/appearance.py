"""Account presentation, shared by login and profile endpoints.

領域：認證
"""

from datetime import datetime, timezone
from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from app.schemas.appearance import AppearancePreferences
from app.toolkit import images


def presentation_fields(user):
    return {
        "appearance": user.appearance,
        "language": user.language or "zh-TW",
        "appearanceImageUrl": "/api/auth/me/appearance-image" if user.appearance_photo_bytes else None,
    }


def save_preferences(value):
    if value is None:
        return None
    result = value.model_dump(mode="json")
    result["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return result


def touch_preferences(user):
    """Image changes must invalidate other devices' cached account background."""
    preferences = user.appearance or AppearancePreferences().model_dump(mode="json")
    user.appearance = {**preferences, "updatedAt": datetime.now(timezone.utc).isoformat()}
    return user.appearance["updatedAt"]


def normalize_avatar(value):
    """Decode real pixels and remove metadata before storing a bounded avatar."""
    raw, _ = images.from_data_uri(value)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"} or source.width * source.height > 16_000_000:
                    raise ValueError
                source.load()
                avatar = ImageOps.exif_transpose(source).convert("RGB")
                avatar.thumbnail((256, 256))
                output = BytesIO()
                avatar.save(output, format="JPEG", quality=86, optimize=True)
                return output.getvalue(), "image/jpeg"
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise images.InvalidImage("大頭貼無法讀取，請選擇有效的 JPEG、PNG 或 WebP 圖片") from None
