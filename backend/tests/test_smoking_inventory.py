"""Actual owner API inventory: chronology, carryover and recoverable legacy data."""
from datetime import date

from sqlalchemy import select

from app.models.lifestyle import SmokingEntry
from app.toolkit import db
from tests.test_lifestyle import account, api  # shared isolated API fixture


def put(api, headers, day, bought, smoked):
    return api.put('/api/lifestyle/smoking/'+day, headers=headers,
                   json={'boughtPacks':bought,'smokedPacks':smoked})


def month(api, headers, value):
    response=api.get('/api/lifestyle/smoking?month='+value,headers=headers)
    assert response.status_code==200,response.text
    return response.json()


def persisted(user_id):
    with db.SessionLocal() as session:
        return [(row.entry_date.isoformat(),row.bought_packs,row.smoked_packs)
                for row in session.scalars(select(SmokingEntry).where(
                    SmokingEntry.user_id==user_id).order_by(SmokingEntry.entry_date))]


def test_first_record_cannot_smoke_more_than_purchased_and_failures_are_atomic(api):
    owner,h=account(api,'stock-first')
    for bought,smoked in [(0,1),(1,2)]:
        response=put(api,h,'2024-01-02',bought,smoked)
        assert response.status_code==409,response.text
        assert '2024-01-02' in response.json()['detail']
        assert persisted(owner)==[]
    response=put(api,h,'2024-01-02',1,1)
    assert response.status_code==200,response.text
    assert response.json()['inventory']=={'openingPacks':0,'closingPacks':0,
        'minimumPacks':0,'shortfallPacks':0,'consistent':True,'firstShortfallDate':None}
    assert put(api,h,'2024-01-02',1,2).status_code==409
    assert persisted(owner)==[('2024-01-02',1,1)]


def test_month_and_year_carryover_can_exceed_this_months_purchases(api):
    owner,h=account(api,'stock-carry')
    assert put(api,h,'2023-12-31',5,1).status_code==200
    response=put(api,h,'2024-01-02',0,3)
    assert response.status_code==200,response.text
    assert response.json()['inventory']['openingPacks']==4
    january=month(api,h,'2024-01')
    assert (january['totalBought'],january['totalSmoked'])==(0,3)
    assert january['inventory']=={'openingPacks':4,'closingPacks':1,'minimumPacks':0,
        'shortfallPacks':0,'consistent':True,'firstShortfallDate':None}
    assert month(api,h,'2024-02')['inventory']['openingPacks']==1
    assert put(api,h,'2024-01-03',0,2).status_code==409
    assert put(api,h,'2024-01-03',0,1).status_code==200
    assert month(api,h,'2024-01')['inventory']['closingPacks']==0


def test_future_purchase_cannot_support_earlier_consumption_even_when_grand_total_fits(api):
    owner,h=account(api,'stock-chronology')
    assert put(api,h,'2024-01-20',10,0).status_code==200
    response=put(api,h,'2024-01-10',0,1)
    assert response.status_code==409 and '2024-01-10' in response.json()['detail']
    assert persisted(owner)==[('2024-01-20',10,0)]
    assert put(api,h,'2024-01-10',1,1).status_code==200
    assert month(api,h,'2024-01')['inventory']['closingPacks']==10


def test_reducing_old_purchases_cannot_invalidate_a_later_month(api):
    owner,h=account(api,'stock-reduce')
    assert put(api,h,'2023-12-31',3,1).status_code==200
    assert put(api,h,'2024-01-02',0,2).status_code==200
    before=persisted(owner)
    response=put(api,h,'2023-12-31',2,1)
    assert response.status_code==409 and '2024-01-02' in response.json()['detail']
    assert persisted(owner)==before
    # Zeroing the purchase also cannot silently delete already consumed stock.
    assert put(api,h,'2023-12-31',0,0).status_code==409
    assert persisted(owner)==before
    # Correct the consumption first, then the old purchase may be reduced.
    assert put(api,h,'2024-01-02',0,1).status_code==200
    assert put(api,h,'2023-12-31',2,1).status_code==200
    assert month(api,h,'2024-01')['inventory']['closingPacks']==0


def test_replacing_same_day_counts_uses_new_totals_not_a_second_purchase(api):
    owner,h=account(api,'stock-replace')
    assert put(api,h,'2024-01-01',2,1).status_code==200
    assert put(api,h,'2024-01-02',0,1).status_code==200
    assert put(api,h,'2024-01-01',3,2).status_code==200
    assert month(api,h,'2024-01')['inventory']['closingPacks']==0
    response=put(api,h,'2024-01-01',3,3)
    assert response.status_code==409 and '2024-01-02' in response.json()['detail']
    assert persisted(owner)==[('2024-01-01',3,2),('2024-01-02',0,1)]


def test_owner_scope_prevents_using_another_accounts_stock(api):
    owner,h=account(api,'stock-owner');other,other_h=account(api,'stock-other')
    assert put(api,other_h,'2024-01-01',100,0).status_code==200
    assert put(api,h,'2024-01-02',0,1).status_code==409
    assert month(api,h,'2024-01')['inventory']['closingPacks']==0
    assert month(api,other_h,'2024-01')['inventory']['closingPacks']==100
    assert persisted(owner)==[]


def test_legacy_shortages_stay_visible_and_can_be_repaired_without_worsening(api):
    owner,h=account(api,'stock-legacy')
    with db.SessionLocal() as session:
        session.add_all([SmokingEntry(user_id=owner,entry_date=date(2024,1,1),bought_packs=0,smoked_packs=3),
                         SmokingEntry(user_id=owner,entry_date=date(2024,1,2),bought_packs=5,smoked_packs=4),
                         SmokingEntry(user_id=owner,entry_date=date(2024,1,3),bought_packs=2,smoked_packs=0)])
        session.commit()
    value=month(api,h,'2024-01')
    assert len(value['days'])==3 and value['totalSmoked']==7
    assert value['inventory']=={'openingPacks':0,'closingPacks':0,'minimumPacks':-3,
        'shortfallPacks':3,'consistent':False,'firstShortfallDate':'2024-01-01'}
    # Fixing a later record may improve stock while an earlier error stays visible.
    response=put(api,h,'2024-01-02',6,4)
    assert response.status_code==200,response.text
    assert response.json()['inventory']['closingPacks']==1
    assert response.json()['inventory']['firstShortfallDate']=='2024-01-01'
    before=persisted(owner)
    assert put(api,h,'2024-01-02',4,4).status_code==409
    assert persisted(owner)==before
    # Later purchases do not pretend to erase an earlier shortage.
    assert put(api,h,'2024-01-04',1,0).status_code==200
    assert month(api,h,'2024-01')['inventory']['consistent'] is False
    assert put(api,h,'2024-01-01',3,3).status_code==200
    assert month(api,h,'2024-01')['inventory']['consistent'] is True
    assert len(persisted(owner))==4


def test_successful_write_returns_authoritative_month_snapshot_including_other_days(api):
    owner,h=account(api,'stock-snapshot')
    assert put(api,h,'2024-01-01',2,0).status_code==200
    earlier_snapshot=month(api,h,'2024-01')
    assert earlier_snapshot['totalBought']==2
    # Another device has recorded an earlier-day purchase before this write.
    assert put(api,h,'2024-01-02',3,0).status_code==200
    response=put(api,h,'2024-01-03',0,1)
    assert response.status_code==200,response.text
    result=response.json()
    assert (result['month'],result['totalBought'],result['totalSmoked'])==('2024-01',5,1)
    assert result['days']==[
        {'date':'2024-01-01','boughtPacks':2,'smokedPacks':0},
        {'date':'2024-01-02','boughtPacks':3,'smokedPacks':0},
        {'date':'2024-01-03','boughtPacks':0,'smokedPacks':1}]
    assert result['inventory']['openingPacks']+result['totalBought']-result['totalSmoked']==result['inventory']['closingPacks']==4
    assert result['days']==month(api,h,'2024-01')['days']
    assert (result['date'],result['boughtPacks'],result['smokedPacks'])==('2024-01-03',0,1)
