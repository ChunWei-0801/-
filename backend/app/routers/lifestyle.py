"""Authenticated birthdays, private health/smoking records, and a savings jar.

領域：生活設定
"""

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.guards import current_user
from app.models import FamilyMember, SavingsGoal, User
from app.models.lifestyle import HealthEntry, LifestylePreferences, SavingsJar, AdditionalSavingsJar, SmokingEntry, SmokingSettings
from app.routers.appearance import normalize_background
from app.schemas.lifestyle import (HealthEntryIn, HealthEntryOut, JarImageIn, PreferencesOut,
                                   PreferencesPatch, SavingsJarOut, SavingsJarPatch, SavingsJarCreate, SavingsJarItem, SavingsJarListOut,
                                   SmokingEntryIn, SmokingEntryOut, SmokingSettingsIn, SmokingSettingsOut)
from app.services.lifestyle import preferences_for, save_habit_preferences, smoking_inventory, require_smoking_stock
from app.toolkit import errors
from app.toolkit.db import get_db

router = APIRouter(tags=["生活設定"])


def _today(preferences):
    return datetime.now(ZoneInfo(preferences.timezone or "Asia/Taipei")).date()


def _day(value, *, today=None):
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value or (today is not None and parsed > today):
            raise ValueError
        return parsed
    except (TypeError, ValueError):
        raise errors.unprocessable("請使用有效的 YYYY-MM-DD 日期，紀錄日期不能在未來") from None


def _preferences(value):
    return {"birthDate": value.birth_date.isoformat() if value.birth_date else None,
            "timezone": value.timezone, "smokingEnabled": value.smoking_enabled,
            "calculatorEnabled": value.calculator_enabled,
            "shortcuts": value.shortcuts or [], "customHabits": value.custom_habits or [],
            "hiddenHabitIds": value.hidden_habit_ids or []}


@router.get("/lifestyle/preferences", summary="我的生活偏好", response_model=PreferencesOut)
def get_preferences(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """我的生活偏好

    Read the owner's exact birthday, timezone, optional tools, shortcuts, and habit choices.
    A historical birth year alone does not invent a birthday.
    """
    preferences = preferences_for(db, me.id)
    db.commit()
    return _preferences(preferences)


@router.put("/lifestyle/preferences", summary="更新我的生活偏好", response_model=PreferencesOut)
def put_preferences(body: PreferencesPatch, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """更新我的生活偏好

    Merge only supplied fields in the owner's row; disabling tools preserves their records.
    Validate the birthday against the selected timezone and synchronize its known birth year.
    """
    preferences = preferences_for(db, me.id)
    fields = body.model_dump(exclude_unset=True, mode="python")
    selected_timezone = fields.get("timezone", preferences.timezone)
    if fields.get("birthDate") is not None:
        if fields["birthDate"] > datetime.now(ZoneInfo(selected_timezone)).date():
            raise errors.unprocessable("生日不能在未來")
    json_fields = body.model_dump(mode="json", exclude_unset=True)
    if {"customHabits", "hiddenHabitIds"} & fields.keys():
        save_habit_preferences(preferences, me, json_fields)
    names = {"birthDate": "birth_date", "timezone": "timezone", "smokingEnabled": "smoking_enabled",
             "calculatorEnabled": "calculator_enabled", "shortcuts": "shortcuts",
             "customHabits": "custom_habits", "hiddenHabitIds": "hidden_habit_ids"}
    for field, value in fields.items():
        if field in {"customHabits", "hiddenHabitIds"}:
            continue
        if field == "shortcuts":
            value = json_fields[field]
        setattr(preferences, names[field], value)
    if "birthDate" in fields:
        me.birth_year = fields["birthDate"].year if fields["birthDate"] else None
    db.commit()
    return _preferences(preferences)


@router.get("/lifestyle/birthdays", summary="今日家人生日")
def get_birthdays(date_: str | None = Query(None, alias="date"), me: User = Depends(current_user), db: Session = Depends(get_db)):
    """今日家人生日

    Return birthday month/day only for self and active members of the same family.
    Exact birth years and unrelated users are never included.
    """
    preferences = preferences_for(db, me.id)
    day = _day(date_) if date_ else _today(preferences)
    own_family = db.scalar(select(FamilyMember.family_id).where(FamilyMember.user_id == me.id,
                                                              FamilyMember.status == "active"))
    user_ids = {me.id}
    if own_family is not None:
        user_ids.update(db.scalars(select(FamilyMember.user_id).where(FamilyMember.family_id == own_family,
                                                                    FamilyMember.status == "active")).all())
    rows = db.execute(select(User, LifestylePreferences).join(LifestylePreferences, User.id == LifestylePreferences.user_id)
                      .where(User.id.in_(user_ids), LifestylePreferences.birth_date.is_not(None))).all()
    members = [{"userId": str(user.id), "displayName": user.display_name, "isSelf": user.id == me.id,
                "month": prefs.birth_date.month, "day": prefs.birth_date.day}
               for user, prefs in rows if (prefs.birth_date.month, prefs.birth_date.day) == (day.month, day.day)]
    db.commit()
    return {"members": sorted(members, key=lambda member: (not member["isSelf"], member["userId"]))}


def _health(entry):
    bmi = (Decimal(entry.weight_kg) / (Decimal(entry.height_cm) / 100) ** 2).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"date": entry.entry_date.isoformat(), "heightCm": float(entry.height_cm),
            "weightKg": float(entry.weight_kg), "bmi": float(bmi)}


@router.get("/lifestyle/health", summary="我的身高體重紀錄")
def get_health(year: int | None = Query(None, ge=1900, le=9999), month: int | None = Query(None, ge=1, le=12),
               me: User = Depends(current_user), db: Session = Depends(get_db)):
    """我的身高體重紀錄

    List the owner's actual measurements in the requested year, optionally narrowed to a month.
    Empty periods remain empty; BMI is calculated from each recorded height and weight.
    """
    preferences = preferences_for(db, me.id)
    year = year or _today(preferences).year
    start = date(year, month or 1, 1)
    end = date(year, month or 12, monthrange(year, month or 12)[1])
    rows = db.scalars(select(HealthEntry).where(HealthEntry.user_id == me.id, HealthEntry.entry_date.between(start, end))
                      .order_by(HealthEntry.entry_date)).all()
    db.commit()
    return {"records": [_health(entry) for entry in rows], "year": year, "month": month}


@router.put("/lifestyle/health/{entry_date}", summary="保存當日身高體重", response_model=HealthEntryOut)
def put_health(entry_date: str, body: HealthEntryIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """保存當日身高體重

    Upsert one owner-only measurement per real date; reject future dates and invalid quantities.
    """
    preferences = preferences_for(db, me.id)
    day = _day(entry_date, today=_today(preferences))
    if body.date is not None and body.date != day:
        raise errors.unprocessable("紀錄日期與網址中的日期不一致")
    row = db.scalar(select(HealthEntry).where(HealthEntry.user_id == me.id, HealthEntry.entry_date == day))
    if row is None:
        row = HealthEntry(user_id=me.id, entry_date=day)
        db.add(row)
    row.height_cm, row.weight_kg = body.heightCm, body.weightKg
    db.flush()
    result = _health(row)
    db.commit()
    return result


@router.delete("/lifestyle/health/{entry_date}", summary="移除自己的當日測量")
def delete_health(entry_date: str, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """移除自己的當日測量

    Delete only the authenticated owner's measurement; repeated deletion is harmless.
    """
    day = _day(entry_date)
    row = db.scalar(select(HealthEntry).where(HealthEntry.user_id == me.id, HealthEntry.entry_date == day))
    if row is not None:
        db.delete(row)
    db.commit()
    return {"ok": True, "date": day.isoformat()}


def _smoking_settings(db, user_id):
    preferences_for(db, user_id)
    settings = db.get(SmokingSettings, user_id)
    if settings is None:
        settings = SmokingSettings(user_id=user_id)
        db.add(settings)
        db.flush()
    return settings


@router.get("/lifestyle/smoking/settings", summary="我的每月吸菸上限", response_model=SmokingSettingsOut)
def get_smoking_settings(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """我的每月吸菸上限

    Read the owner's persistent limit without exposing another person's health choices.
    """
    settings = _smoking_settings(db, me.id)
    result = {"monthlyLimit": settings.monthly_limit}
    db.commit()
    return result


@router.put("/lifestyle/smoking/settings", summary="設定每月吸菸上限", response_model=SmokingSettingsOut)
def put_smoking_settings(body: SmokingSettingsIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """設定每月吸菸上限

    Save a nonnegative integer limit; zero means no numeric allowance has been set.
    """
    settings = _smoking_settings(db, me.id)
    settings.monthly_limit = body.monthlyLimit
    db.commit()
    return {"monthlyLimit": settings.monthly_limit}


def _smoking(entry):
    return {"date": entry.entry_date.isoformat(), "boughtPacks": entry.bought_packs, "smokedPacks": entry.smoked_packs}


@router.get("/lifestyle/smoking", summary="我的每月買菸與吸菸紀錄")
def get_smoking(month: str | None = None, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """我的每月買菸與吸菸紀錄

    Month totals include only that month; inventory carries all earlier owner stock.
    Historical deficits stay visible. A zero limit returns a null ratio.
    """
    settings = _smoking_settings(db, me.id)
    preferences = db.get(LifestylePreferences, me.id)
    month = month or _today(preferences).strftime("%Y-%m")
    try:
        start = date.fromisoformat(month + "-01")
        if start.strftime("%Y-%m") != month:
            raise ValueError
    except ValueError:
        raise errors.unprocessable("月份請使用有效的 YYYY-MM") from None
    end = date(start.year, start.month, monthrange(start.year, start.month)[1])
    history = db.scalars(select(SmokingEntry).where(SmokingEntry.user_id == me.id, SmokingEntry.entry_date <= end)
                         .order_by(SmokingEntry.entry_date)).all()
    rows = [row for row in history if row.entry_date >= start]
    bought, smoked = sum(row.bought_packs for row in rows), sum(row.smoked_packs for row in rows)
    result = {"month": month, "days": [_smoking(row) for row in rows], "totalBought": bought, "totalSmoked": smoked,
              "monthlyLimit": settings.monthly_limit, "ratio": smoked / settings.monthly_limit if settings.monthly_limit else None,
              "inventory": smoking_inventory(history, start, end)}
    db.commit()
    return result


@router.put("/lifestyle/smoking/{entry_date}", summary="保存當日買菸與吸菸包數", response_model=SmokingEntryOut)
def put_smoking(entry_date: str, body: SmokingEntryIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """保存當日買菸與吸菸包數

    Upsert owner daily counts under a user-row lock, preserving chronological stock.
    Reject new or worse shortages; prior-month stock remains usable.
    """
    preferences = preferences_for(db, me.id)
    day = _day(entry_date, today=_today(preferences))
    if body.date is not None and body.date != day:
        raise errors.unprocessable("紀錄日期與網址中的日期不一致")
    require_smoking_stock(db, me.id, day, body.boughtPacks, body.smokedPacks)
    row = db.scalar(select(SmokingEntry).where(SmokingEntry.user_id == me.id, SmokingEntry.entry_date == day))
    if row is None:
        row = SmokingEntry(user_id=me.id, entry_date=day)
        db.add(row)
    row.bought_packs, row.smoked_packs = body.boughtPacks, body.smokedPacks
    db.flush()
    result = _smoking(row)
    start = day.replace(day=1)
    end = day.replace(day=monthrange(day.year, day.month)[1])
    history = db.scalars(select(SmokingEntry).where(SmokingEntry.user_id == me.id, SmokingEntry.entry_date <= end)
                         .order_by(SmokingEntry.entry_date)).all()
    result["inventory"] = smoking_inventory(history, start, end)
    month_rows = [entry for entry in history if entry.entry_date >= start]
    result.update({"month": "%04d-%02d" % (day.year, day.month),
                   "days": [_smoking(entry) for entry in month_rows],
                   "totalBought": sum(entry.bought_packs for entry in month_rows),
                   "totalSmoked": sum(entry.smoked_packs for entry in month_rows)})
    db.commit()
    return result


def _jar(db, user_id):
    preferences = preferences_for(db, user_id)
    jar = db.get(SavingsJar, user_id)
    if jar is None:
        month = _today(preferences).strftime("%Y-%m")
        goal = db.scalar(select(SavingsGoal.goal_amount).where(SavingsGoal.user_id == user_id,
                        SavingsGoal.group_id.is_(None), (SavingsGoal.period_key.is_(None) | (SavingsGoal.period_key <= month)))
                         .order_by(SavingsGoal.period_key.desc().nullslast(), SavingsGoal.id.desc()).limit(1))
        jar = SavingsJar(user_id=user_id, target_amount=goal or Decimal("0"))
        db.add(jar)
        db.flush()
    return jar


def _jar_dict(jar):
    target, saved = Decimal(jar.target_amount), Decimal(jar.saved_amount)
    progress = min(Decimal("100"), saved / target * 100) if target > 0 else Decimal("0")
    return {"name": jar.name, "targetAmount": float(target), "savedAmount": float(saved), "shape": jar.shape,
            "imageUrl": "/api/lifestyle/jar/image" if jar.photo_bytes else None,
            "progressPercent": float(progress.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))}


def _additional_jar(db, jar_id, user_id):
    jar = db.scalar(select(AdditionalSavingsJar).where(AdditionalSavingsJar.id == jar_id, AdditionalSavingsJar.user_id == user_id))
    if jar is None:
        raise errors.not_found("找不到自己的存錢筒")
    return jar


def _additional_jar_dict(jar):
    result = _jar_dict(jar)
    result["id"] = str(jar.id)
    result["imageUrl"] = f"/api/lifestyle/jars/{jar.id}/image" if jar.photo_bytes else None
    return result


@router.get("/lifestyle/jars", summary="列出自己的所有存錢筒", response_model=SavingsJarListOut)
def get_jars(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """列出自己的所有存錢筒

    The original jar and its photo remain intact; additional jars are owner-only.
    """
    original = {**_jar_dict(_jar(db, me.id)), "id": "default"}
    rows = db.scalars(select(AdditionalSavingsJar).where(AdditionalSavingsJar.user_id == me.id).order_by(AdditionalSavingsJar.id)).all()
    result = {"jars": [original] + [_additional_jar_dict(row) for row in rows]}
    db.commit()
    return result


@router.post("/lifestyle/jars", summary="新增自己的存錢筒", response_model=SavingsJarItem, status_code=201)
def create_jar(body: SavingsJarCreate, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """新增自己的存錢筒

    Each new jar has independent whole-TWD amounts and its own private image.
    """
    jar = AdditionalSavingsJar(user_id=me.id, name=body.name, target_amount=body.targetAmount,
                               saved_amount=body.savedAmount, shape=body.shape)
    db.add(jar)
    db.flush()
    result = _additional_jar_dict(jar)
    db.commit()
    return result


@router.put("/lifestyle/jars/{jar_id}", summary="更新指定的私人存錢筒", response_model=SavingsJarItem)
def update_additional_jar(jar_id: int, body: SavingsJarPatch, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """更新指定的私人存錢筒

    Updates never affect another jar, the original jar, or ledger balances.
    """
    jar = _additional_jar(db, jar_id, me.id)
    names = {"name": "name", "targetAmount": "target_amount", "savedAmount": "saved_amount", "shape": "shape"}
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(jar, names[key], value)
    db.flush()
    result = _additional_jar_dict(jar)
    db.commit()
    return result


@router.put("/lifestyle/jars/{jar_id}/image", summary="儲存指定存錢筒的私人照片", response_model=SavingsJarItem)
def put_additional_jar_image(jar_id: int, body: JarImageIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """儲存指定存錢筒的私人照片

    Normalize owner-supplied raster bytes without replacing another jar's photo.
    """
    jar = _additional_jar(db, jar_id, me.id)
    jar.photo_bytes = normalize_background(body.image, preserve_alpha=True)
    jar.photo_mime = "image/png" if jar.photo_bytes.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg"
    result = _additional_jar_dict(jar)
    db.commit()
    return result


@router.get("/lifestyle/jars/{jar_id}/image", summary="讀取指定存錢筒的私人照片", response_class=Response)
def get_additional_jar_image(jar_id: int, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """讀取指定存錢筒的私人照片

    Return authenticated owner bytes with no-store caching, including after logout.
    """
    jar = _additional_jar(db, jar_id, me.id)
    if not jar.photo_bytes:
        raise errors.not_found("尚未設定存錢筒照片")
    return Response(jar.photo_bytes, media_type=jar.photo_mime or "image/jpeg",
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/lifestyle/jar", summary="我的存錢筒", response_model=SavingsJarOut)
def get_jar(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """我的存錢筒

    Read a manually tracked owner jar, initially seeded from the applicable monthly savings goal.
    Ledger balances never silently change the manually entered saved amount.
    """
    jar = _jar(db, me.id)
    result = _jar_dict(jar)
    db.commit()
    return result


@router.put("/lifestyle/jar", summary="更新存錢筒名稱外型與金額", response_model=SavingsJarOut)
def put_jar(body: SavingsJarPatch, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """更新存錢筒名稱外型與金額

    Merge only submitted owner fields. Changed TWD amounts are whole units;
    legacy balances remain readable and independent of ledger totals.
    """
    jar = _jar(db, me.id)
    names = {"name": "name", "targetAmount": "target_amount", "savedAmount": "saved_amount", "shape": "shape"}
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(jar, names[key], value)
    db.flush()
    result = _jar_dict(jar)
    db.commit()
    return result


@router.put("/lifestyle/jar/image", summary="儲存私人存錢筒照片", response_model=SavingsJarOut)
def put_jar_image(body: JarImageIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """儲存私人存錢筒照片

    Decode and normalize a private raster photo into persistent database bytes.
    """
    jar = _jar(db, me.id)
    jar.photo_bytes = normalize_background(body.image, preserve_alpha=True)
    jar.photo_mime = "image/png" if jar.photo_bytes.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg"
    result = _jar_dict(jar)
    db.commit()
    return result


@router.get("/lifestyle/jar/image", summary="讀取自己的存錢筒照片", response_class=Response)
def get_jar_image(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """讀取自己的存錢筒照片

    Return only the authenticated owner's photo with private no-store caching headers.
    """
    jar = db.get(SavingsJar, me.id)
    if jar is None or not jar.photo_bytes:
        raise errors.not_found("尚未設定存錢筒照片")
    return Response(jar.photo_bytes, media_type=jar.photo_mime or "image/jpeg",
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/lifestyle/jar/image", summary="移除自己的存錢筒照片")
def delete_jar_image(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """移除自己的存錢筒照片

    Clear the owner's photo while preserving the jar's shape, name, target, and saved amount.
    """
    jar = _jar(db, me.id)
    jar.photo_bytes = jar.photo_mime = None
    result = _jar_dict(jar)
    db.commit()
    return result
