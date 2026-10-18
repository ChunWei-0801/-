"""Durable owner settings and bounded private lifestyle photos.

領域：生活設定
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app import catalog
from app.models import User
from app.models.lifestyle import LifestylePreferences


def preferences_for(db, user_id):
    """Serialize first creation and partial preference updates on the user row."""
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).scalar_one()
    preferences = db.get(LifestylePreferences, user_id)
    if preferences is None:
        preferences = LifestylePreferences(user_id=user_id)
        db.add(preferences)
        db.flush()
    return preferences


def habit_options(preferences, *, include_hidden=False):
    """Only caller-loaded account options become accepted habit identifiers."""
    options = [*catalog.FINANCE_HABITS, *(preferences.custom_habits or [])]
    hidden = set(preferences.hidden_habit_ids or [])
    return options if include_hidden else [item for item in options if item["id"] not in hidden]


def save_habit_preferences(preferences, user, fields):
    """Merge options and prune deleted or hidden selections in the same transaction."""
    from app.toolkit import errors

    custom = fields.get("customHabits", preferences.custom_habits or [])
    allowed = {item["id"] for item in catalog.FINANCE_HABITS} | {item["id"] for item in custom}
    if "hiddenHabitIds" in fields and not set(fields["hiddenHabitIds"]).issubset(allowed):
        raise errors.unprocessable("隱藏選項必須是既有的理財習慣")
    preferences.custom_habits = custom
    preferences.hidden_habit_ids = [item for item in fields.get("hiddenHabitIds", preferences.hidden_habit_ids or []) if item in allowed]
    if user.finance_habits is not None:
        visible = {item["id"] for item in habit_options(preferences)}
        user.finance_habits = [item for item in user.finance_habits if item in visible]


def birthday_fields(user, db):
    """Exact birthday stays owner-only; use local month/day when calculating age."""
    preferences = db.get(LifestylePreferences, user.id)
    birthday = preferences.birth_date if preferences else None
    if not birthday:
        return {"birthDate": None}
    today = datetime.now(ZoneInfo(preferences.timezone)).date()
    age = today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))
    return {"birthDate": birthday.isoformat(), "age": age}


def profile_birthday_change(user, body, db):
    """Keep the legacy birth year coherent when an exact birthday is changed."""
    from app.toolkit import errors

    sent = body.model_fields_set
    if "birthDate" not in sent:
        preferences = db.get(LifestylePreferences, user.id)
        if "birthYear" in sent and preferences and preferences.birth_date:
            if body.birthYear != preferences.birth_date.year:
                preferences.birth_date = None
        return {}
    preferences = preferences_for(db, user.id)
    birthday = body.birthDate
    if birthday is not None:
        today = datetime.now(ZoneInfo(preferences.timezone)).date()
        if birthday.year < 1900 or birthday > today:
            raise errors.unprocessable("請填寫 1900 年至今天之間的生日")
        if "birthYear" in sent and body.birthYear != birthday.year:
            raise errors.unprocessable("出生年份與完整生日不一致")
    preferences.birth_date = birthday
    return {"birth_year": birthday.year if birthday else (body.birthYear if "birthYear" in sent else None)}
