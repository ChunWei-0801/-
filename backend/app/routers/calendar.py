"""領域：認證。Owner-scoped calendar, one-tap shifts, and foreground reminder delivery."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.guards import current_user
from app.models import User
from app.models.calendar import CalendarEvent, CalendarMarker
from app.schemas.calendar import AcknowledgeIn, EventIn, EventPatch, MarkerIn, ShiftIn
from app.services.lifestyle import preferences_for
from app.toolkit import errors
from app.toolkit.db import get_db

router = APIRouter(tags=['我的行事曆'])
PRESETS = [{'key':'early','name':'早班','icon':'☀️','color':'#b97714'},
           {'key':'mid','name':'午班','icon':'◐','color':'#28749b'},
           {'key':'late','name':'晚班','icon':'🌙','color':'#7554a3'}]


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value and value.tzinfo is None else value.isoformat() if value else None


def output(row):
    return {'id':row.id,'date':row.day.isoformat(),'title':row.title,'memo':row.memo,'time':row.clock_time,
            'kind':'shift' if row.shift_slot else 'event','marker':row.marker,'timezone':row.timezone,
            'startsAt':iso(row.starts_at),'reminderMinutes':row.reminder_minutes,'remindAt':iso(row.remind_at),'updatedAt':iso(row.updated_at)}


def marker_output(row):
    return {'key':row.preset_key or 'custom:'+str(row.id),'name':row.name,'icon':row.icon,'color':row.color}


def owned(db, model, uid, key):
    row = db.scalar(select(model).where(model.id == key, model.user_id == uid))
    if row is None:
        raise errors.not_found('找不到這個項目')
    return row


def scheduled(row, zone):
    row.timezone = zone
    local = datetime.combine(row.day, time.fromisoformat(row.clock_time or '09:00'))
    row.starts_at = local.replace(tzinfo=ZoneInfo(zone)).astimezone(timezone.utc)
    if row.starts_at.astimezone(ZoneInfo(zone)).replace(tzinfo=None) != local:
        raise errors.unprocessable('這個時間落在夏令時間切換空檔，請選另一個時間')
    row.remind_at = row.starts_at - timedelta(minutes=row.reminder_minutes) if row.reminder_minutes is not None else None
    row.acknowledged_at = None
    row.updated_at = datetime.now(timezone.utc)


@router.get('/lifestyle/calendar/markers', summary='讀取自己的班別標記')
def markers(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """讀取自己的班別標記

    登入本人專用；回傳三個預設班別及本人自訂標記。
    """
    rows = db.scalars(select(CalendarMarker).where(CalendarMarker.user_id == me.id).order_by(CalendarMarker.id)).all()
    overrides={r.preset_key:marker_output(r) for r in rows if r.preset_key}
    return {'items':[overrides.get(p['key'],p) for p in PRESETS] + [marker_output(r) for r in rows if not r.preset_key]}


@router.post('/lifestyle/calendar/markers', status_code=201, summary='新增自己的班別標記')
def add_marker(body: MarkerIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """新增自己的班別標記

    登入本人專用；接受名稱、圖案及色碼，回傳新標記。
    """
    if len(db.scalars(select(CalendarMarker.id).where(CalendarMarker.user_id == me.id).limit(40)).all()) >= 40:
        raise errors.unprocessable('最多可建立40個自訂班別標記')
    row = CalendarMarker(user_id=me.id, **body.model_dump()); db.add(row); db.commit(); db.refresh(row)
    return marker_output(row)


@router.put('/lifestyle/calendar/markers/{marker_key}', summary='修改自己的班別標記')
def change_marker(marker_key: str, body: MarkerIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """修改自己的班別標記

    登入本人專用；依預設鍵或自訂編號修改名稱、圖案與色碼。
    """
    if marker_key in {'early','mid','late'}:
        row=db.scalar(select(CalendarMarker).where(CalendarMarker.user_id==me.id,CalendarMarker.preset_key==marker_key))
        if row is None:row=CalendarMarker(user_id=me.id,preset_key=marker_key);db.add(row)
    elif marker_key.isdecimal():row=owned(db,CalendarMarker,me.id,int(marker_key))
    else:raise errors.not_found('找不到這個標記')
    for key,value in body.model_dump().items():setattr(row,key,value)
    try:db.commit()
    except IntegrityError:
        db.rollback();raise errors.conflict('這個標記剛被更新，請重新讀取') from None
    return marker_output(row)


@router.delete('/lifestyle/calendar/markers/{marker_key}', status_code=204, summary='移除自己的班別標記')
def delete_marker(marker_key: str, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """移除自己的班別標記

    登入本人專用；預設標記恢復原設定，自訂標記刪除；舊班表快照保留。
    """
    if marker_key in {'early','mid','late'}:
        row=db.scalar(select(CalendarMarker).where(CalendarMarker.user_id==me.id,CalendarMarker.preset_key==marker_key))
        if row is None:return Response(status_code=204)
    elif marker_key.isdecimal():row=owned(db,CalendarMarker,me.id,int(marker_key))
    else:raise errors.not_found('找不到這個標記')
    db.delete(row);db.commit();return Response(status_code=204)


@router.get('/lifestyle/calendar/events', summary='查詢自己的行事曆')
def events(start: date, end: date, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """查詢自己的行事曆

    登入本人專用；start及end限93日內，最多回傳500筆並標示截斷。
    """
    if end < start or (end-start).days > 93:
        raise errors.unprocessable('請選擇93日內的日期範圍')
    rows = db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == me.id, CalendarEvent.day >= start, CalendarEvent.day <= end).order_by(CalendarEvent.day, CalendarEvent.clock_time, CalendarEvent.id).limit(501)).all()
    return {'items':[output(r) for r in rows[:500]],'truncated':len(rows)>500}


@router.post('/lifestyle/calendar/events', status_code=201, summary='新增自己的行程')
def add_event(body: EventIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """新增自己的行程

    登入本人專用；接受日期、標題、時間及提醒，依本人時區計算UTC提醒時間。
    """
    prefs=preferences_for(db, me.id)
    row=CalendarEvent(user_id=me.id,day=body.date,title=body.title,memo=body.memo,clock_time=body.time,reminder_minutes=body.reminderMinutes,shift_slot=None,marker=None)
    scheduled(row,prefs.timezone); db.add(row); db.commit(); db.refresh(row); return output(row)


@router.patch('/lifestyle/calendar/events/{event_id}', summary='修改自己的行程')
def change_event(event_id: int, body: EventPatch, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """修改自己的行程

    登入本人專用；僅更新提交欄位，不可存取其他人的行程。
    """
    row=owned(db,CalendarEvent,me.id,event_id);previous=(row.day,row.clock_time,row.reminder_minutes,row.timezone);ack=row.acknowledged_at;names={'date':'day','title':'title','memo':'memo','time':'clock_time','reminderMinutes':'reminder_minutes'}
    for key,value in body.model_dump(exclude_unset=True).items(): setattr(row,names[key],value)
    scheduled(row,row.timezone)
    if previous==(row.day,row.clock_time,row.reminder_minutes,row.timezone):row.acknowledged_at=ack
    try:db.commit()
    except IntegrityError:
        db.rollback();raise errors.conflict('這一天已有班別，請先移除原班別或選另一個日期') from None
    return output(row)


@router.delete('/lifestyle/calendar/events/{event_id}', status_code=204, summary='刪除自己的行程')
def delete_event(event_id: int, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """刪除自己的行程

    登入本人專用；依本人行程編號刪除，其他帳號回傳404。
    """
    db.delete(owned(db,CalendarEvent,me.id,event_id));db.commit();return Response(status_code=204)


@router.put('/lifestyle/calendar/shifts/{day}', summary='設定自己的當日班別')
def put_shift(day: str, body: ShiftIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """設定自己的當日班別

    登入本人專用；日期配合markerKey即可換班，同日只有一個班別，保留未提交的備註與提醒。
    """
    try:
        parsed=date.fromisoformat(day)
        if parsed.isoformat()!=day or not date(1901,1,1)<=parsed<=date(2099,12,31): raise ValueError
    except ValueError:
        raise errors.unprocessable('請使用有效的YYYY-MM-DD日期') from None
    override=db.scalar(select(CalendarMarker).where(CalendarMarker.user_id==me.id,CalendarMarker.preset_key==body.markerKey)) if body.markerKey in {'early','mid','late'} else None
    zone=preferences_for(db,me.id).timezone
    marker=marker_output(override) if override else next((dict(m) for m in PRESETS if m['key']==body.markerKey),None)
    if marker is None: marker=marker_output(owned(db,CalendarMarker,me.id,int(body.markerKey.split(':')[1])))
    row=db.scalar(select(CalendarEvent).where(CalendarEvent.user_id==me.id,CalendarEvent.day==parsed,CalendarEvent.shift_slot==1))
    if row is None:
        row=CalendarEvent(user_id=me.id,day=parsed,shift_slot=1,memo='',clock_time=None,reminder_minutes=None);db.add(row)
    previous=(row.day,row.clock_time,row.reminder_minutes,row.timezone);ack=row.acknowledged_at
    row.marker=marker;row.title=marker['name'];names={'memo':'memo','time':'clock_time','reminderMinutes':'reminder_minutes'}
    for key,value in body.model_dump(exclude_unset=True).items():
        if key in names:setattr(row,names[key],value)
    scheduled(row,zone)
    if previous==(row.day,row.clock_time,row.reminder_minutes,row.timezone):row.acknowledged_at=ack
    try: db.commit()
    except IntegrityError:
        db.rollback();raise errors.conflict('這一天的班別剛被更新，請重新讀取') from None
    db.refresh(row);return output(row)


@router.get('/lifestyle/calendar/reminders', summary='查詢自己的到期提醒')
def reminders(me: User = Depends(current_user), db: Session = Depends(get_db)):
    """查詢自己的到期提醒

    登入本人專用；僅回傳過去24小時尚未確認的到期提醒，每次最多20筆。
    """
    now=datetime.now(timezone.utc)
    rows=db.scalars(select(CalendarEvent).where(CalendarEvent.user_id==me.id,CalendarEvent.remind_at<=now,CalendarEvent.remind_at>=now-timedelta(days=1),CalendarEvent.acknowledged_at.is_(None)).order_by(CalendarEvent.remind_at).limit(20)).all()
    return {'items':[output(r) for r in rows]}


@router.post('/lifestyle/calendar/reminders/ack', status_code=204, summary='確認自己的提醒已送達')
def acknowledge(body: AcknowledgeIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    """確認自己的提醒已送達

    登入本人專用；接受最多50個行程編號，只確認本人項目且不修改其他帳號。
    """
    rows=db.scalars(select(CalendarEvent).where(CalendarEvent.user_id==me.id,CalendarEvent.id.in_(body.ids))).all()
    for row in rows: row.acknowledged_at=datetime.now(timezone.utc)
    db.commit();return Response(status_code=204)
