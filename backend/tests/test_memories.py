"""Photo ACL and server-owned puzzle progression across real API requests."""

from __future__ import annotations

import io
import os
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "memories-tests-a-different-long-secret-value-32")

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.main import app
from app.models import Category, Group, GroupMember, Transaction, User
from app.models.memories import PuzzleEarning, PuzzleGame, TransactionPhoto
from app.services import memories
from app.toolkit import crud, db, tokens
from app.toolkit.config import settings


def picture(color="forestgreen", size=(80, 60), format="PNG"):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format=format)
    return output.getvalue()


@pytest.fixture()
def memory_api(monkeypatch):
    original = str(db.engine.url)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "require_email_verification", False)
    db.use_database("sqlite://")
    db.create_all()
    me = crud.save(User, {"email": "memories@example.com", "display_name": "My memories", "password_hash": "unused", "theme": "paper"})
    other = crud.save(User, {"email": "other-memories@example.com", "display_name": "Another person", "password_hash": "unused", "theme": "paper"})
    group = crud.save(Group, {"name": "Private", "created_by": me.id})
    crud.save(GroupMember, {"group_id": group.id, "user_id": me.id})
    cat = crud.save(Category, {"name": "餐飲", "kind": "expense", "color": "cat-food"})
    headers = {"Authorization": "Bearer " + tokens.make_access_token(me.id)}
    other_headers = {"Authorization": "Bearer " + tokens.make_access_token(other.id)}
    with TestClient(app) as api:
        yield api, me, other, group, cat, headers, other_headers
    db.drop_all()
    db.use_database(original)


def add_transaction(ctx, *, note="purchase", amount=123.45):
    api, _me, _other, group, cat, headers, _other_headers = ctx
    response = api.post("/api/transactions", headers=headers, json={
        "date": date.today().isoformat(), "amount": amount, "kind": "expense",
        "cat": str(cat.id), "groupId": str(group.id), "note": note,
    })
    assert response.status_code == 201, response.text
    return response.json()


def get_state(ctx):
    response = ctx[0].get("/api/memories", headers=ctx[5])
    assert response.status_code == 200, response.text
    return response.json()


def start(ctx, data=None):
    return ctx[0].post("/api/memories/puzzles", headers=ctx[5],
                       files={"file": ("memory.png", data or picture(), "image/png")})


def configure(ctx, **extra):
    response = ctx[0].patch("/api/memories/settings", headers=ctx[5],
                            json={"pieceCount": 9, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_photo_is_decoded_oriented_normalized_and_persisted(memory_api):
    api, _me, _other, _group, _cat, auth, _other_auth = memory_api
    tx = add_transaction(memory_api)
    original = picture(size=(3000, 1000))
    response = api.post(f"/api/transactions/{tx['id']}/photos", headers=auth,
                        files={"file": ("photo.jpg", original, "text/plain")})
    assert response.status_code == 201, response.text
    photo = response.json()
    assert (photo["width"], photo["height"]) == (1920, 640)
    stored = crud.get(TransactionPhoto, int(photo["id"]))
    assert stored.image_mime == "image/jpeg" and stored.image_data != original
    viewed = api.get(photo["url"], headers=auth)
    assert viewed.status_code == 200 and viewed.headers["content-type"] == "image/jpeg"
    assert viewed.headers["cache-control"] == "private, no-store"
    assert Image.open(io.BytesIO(viewed.content)).size == (1920, 640)
    listed = api.get(f"/api/transactions/{tx['id']}/photos", headers=auth).json()["photos"][0]
    assert listed["id"] == photo["id"]
    assert listed["createdAt"].endswith("+00:00")


def test_phone_exif_orientation_is_applied_and_location_metadata_removed(memory_api):
    transaction = add_transaction(memory_api)
    image = Image.new("RGB", (120, 60), "blue")
    exif = Image.Exif()
    exif[274] = 6  # Rotate a landscape sensor image clockwise for portrait view.
    exif[315] = "private camera owner"
    original = io.BytesIO()
    image.save(original, "JPEG", exif=exif)
    response = memory_api[0].post(f"/api/transactions/{transaction['id']}/photos", headers=memory_api[5],
                                 files={"file": ("phone.jpg", original.getvalue(), "image/jpeg")})
    assert response.status_code == 201, response.text
    assert (response.json()["width"], response.json()["height"]) == (60, 120)
    saved = Image.open(io.BytesIO(memory_api[0].get(response.json()["url"], headers=memory_api[5]).content))
    assert not saved.getexif()


def test_upload_size_is_checked_before_image_decoding(memory_api, monkeypatch):
    transaction = add_transaction(memory_api)
    monkeypatch.setattr(memories, "MAX_UPLOAD_BYTES", 20)
    response = memory_api[0].post(f"/api/transactions/{transaction['id']}/photos", headers=memory_api[5],
                                 files={"file": ("photo.png", picture(), "image/png")})
    assert response.status_code == 422 and "20 MB" in response.json()["detail"]
    assert crud.count(TransactionPhoto) == 0


def test_photo_acl_is_same_as_ledger_and_owner_only_for_changes(memory_api):
    api, _me, other, group, _cat, auth, other_auth = memory_api
    tx = add_transaction(memory_api)
    uploaded = api.post(f"/api/transactions/{tx['id']}/photos", headers=auth,
                        files={"file": ("memory.png", picture(), "image/png")}).json()
    assert api.get(uploaded["url"]).status_code == 401
    assert api.get(uploaded["url"], headers=other_auth).status_code == 403
    assert api.get(f"/api/transactions/{tx['id']}/photos", headers=other_auth).status_code == 403
    crud.save(GroupMember, {"group_id": group.id, "user_id": other.id})
    assert api.get(uploaded["url"], headers=other_auth).status_code == 200
    assert api.get(f"/api/transactions/{tx['id']}/photos", headers=other_auth).status_code == 200
    assert api.post(f"/api/transactions/{tx['id']}/photos", headers=other_auth,
                    files={"file": ("memory.png", picture(), "image/png")}).status_code == 403
    assert api.delete(f"/api/transaction-photos/{uploaded['id']}", headers=other_auth).status_code == 403
    assert api.delete(f"/api/transaction-photos/{uploaded['id']}", headers=auth).status_code == 200
    assert api.get(uploaded["url"], headers=auth).status_code == 404


@pytest.mark.parametrize("content", [b"\x89PNG\r\n\x1a\nmalicious text", b"<svg><script>alert(1)</script></svg>", b""])
def test_fake_or_empty_images_are_rejected_by_actual_decoding(memory_api, content):
    tx = add_transaction(memory_api)
    response = memory_api[0].post(f"/api/transactions/{tx['id']}/photos", headers=memory_api[5],
                                 files={"file": ("photo.png", content, "image/png")})
    assert response.status_code == 422
    assert crud.count(TransactionPhoto) == 0


def test_each_transaction_caps_photos_and_delete_cascades(memory_api):
    api, *_rest = memory_api
    tx = add_transaction(memory_api)
    for _ in range(4):
        assert api.post(f"/api/transactions/{tx['id']}/photos", headers=memory_api[5],
                        files={"file": ("memory.png", picture(), "image/png")}).status_code == 201
    assert api.post(f"/api/transactions/{tx['id']}/photos", headers=memory_api[5],
                    files={"file": ("memory.png", picture(), "image/png")}).status_code == 409
    assert api.delete(f"/api/transactions/{tx['id']}", headers=memory_api[5]).status_code == 200
    assert crud.count(TransactionPhoto) == 0


def test_new_transactions_before_first_visit_also_earn_and_edits_do_not_duplicate(memory_api):
    before = add_transaction(memory_api, note="before activation")
    assert get_state(memory_api)["totalEarned"] == 1
    after = add_transaction(memory_api, note="after activation")
    assert get_state(memory_api)["creditsAvailable"] == 2
    response = memory_api[0].patch(f"/api/transactions/{after['id']}", headers=memory_api[5], json={"note": "edited"})
    assert response.status_code == 200, response.text
    state = get_state(memory_api)
    assert state["totalEarned"] == state["creditsAvailable"] == 2
    assert crud.count(PuzzleEarning) == 2
    assert before["id"] != after["id"]


def test_unfinished_game_cannot_be_replaced_even_across_new_month(memory_api, monkeypatch):
    configure(memory_api, changesPerPeriod=31)
    created = start(memory_api)
    assert created.status_code == 201, created.text
    add_transaction(memory_api)
    assert get_state(memory_api)["current"]["earnedPieces"] == 1
    assert start(memory_api).status_code == 409
    monkeypatch.setattr(memories, "utcnow", lambda: datetime.now(timezone.utc) + timedelta(days=40))
    assert start(memory_api).status_code == 409
    assert crud.count(PuzzleGame) == 1


def test_delete_and_recreate_does_not_mint_another_piece(memory_api):
    configure(memory_api)
    assert start(memory_api).status_code == 201
    tx = add_transaction(memory_api, note="same record")
    assert get_state(memory_api)["current"]["earnedPieces"] == 1
    assert memory_api[0].delete(f"/api/transactions/{tx['id']}", headers=memory_api[5]).status_code == 200
    assert get_state(memory_api)["current"]["earnedPieces"] == 0
    assert get_state(memory_api)["creditsAvailable"] == 0
    add_transaction(memory_api, note="same record")
    assert get_state(memory_api)["current"]["earnedPieces"] == 1
    assert crud.count(PuzzleEarning) == 1
    # A second purchase with identical content while the first still exists is
    # a separate genuine transaction, and therefore earns its own piece.
    add_transaction(memory_api, note="same record")
    assert get_state(memory_api)["current"]["earnedPieces"] == 2
    assert crud.count(PuzzleEarning) == 2


def test_edit_delete_recreate_restores_original_earning_instead_of_minting(memory_api):
    configure(memory_api)
    transaction = add_transaction(memory_api, note="before editing")
    response = memory_api[0].patch(f"/api/transactions/{transaction['id']}", headers=memory_api[5],
                                  json={"note": "after editing", "amount": 200})
    assert response.status_code == 200, response.text
    assert memory_api[0].delete(f"/api/transactions/{transaction['id']}", headers=memory_api[5]).status_code == 200
    add_transaction(memory_api, note="after editing", amount=200)
    assert get_state(memory_api)["totalEarned"] == 1
    assert get_state(memory_api)["creditsAvailable"] == 1


def test_completion_snapshot_and_achievement_filters_survive_next_puzzle(memory_api):
    api, _me, _other, _group, _cat, auth, other_auth = memory_api
    configure(memory_api, wallName="旅行回憶", changesPerPeriod=2, timezone="Asia/Taipei")
    first = start(memory_api, picture("red")).json()["current"]
    for number in range(9):
        add_transaction(memory_api, note=f"memory {number}")
    # Completion is durable in the ninth ledger write, before reopening the UI.
    durable = crud.get(PuzzleGame, first["id"])
    assert durable.completed_at is not None and durable.earned_pieces == 9
    completed = get_state(memory_api)["current"]
    assert completed["completed"] is True and completed["earnedPieces"] == 9
    assert completed["completedAt"] is not None
    assert completed["completedAt"].endswith("+00:00")
    first_image = api.get(first["imageUrl"], headers=auth).content
    second = start(memory_api, picture("blue"))
    assert second.status_code == 201, second.text
    assert second.json()["current"]["id"] != first["id"]
    assert api.get(first["imageUrl"], headers=auth).content == first_image
    assert api.get(first["imageUrl"], headers=other_auth).status_code == 404
    achievements = api.get(f"/api/memories/achievements?year={completed['year']}&month={completed['month']}", headers=auth).json()
    assert achievements["total"] == 1 and achievements["achievements"][0]["id"] == first["id"]
    assert achievements["years"] == [completed["year"]]
    assert api.get("/api/memories/achievements", headers=other_auth).json()["achievements"] == []


def test_completed_piece_cannot_be_farmed_into_next_puzzle_by_recreating_record(memory_api):
    configure(memory_api, changesPerPeriod=2)
    first = start(memory_api).json()["current"]
    transactions = [add_transaction(memory_api, note=f"purchase {number}") for number in range(9)]
    assert start(memory_api).status_code == 201
    first_transaction = transactions[0]
    assert memory_api[0].delete(f"/api/transactions/{first_transaction['id']}", headers=memory_api[5]).status_code == 200
    add_transaction(memory_api, note="purchase 0")
    state = get_state(memory_api)
    assert state["current"]["earnedPieces"] == state["creditsAvailable"] == 0
    assert state["totalEarned"] == 9
    assert crud.get(PuzzleGame, first["id"]).completed_at is not None


def test_period_limit_is_enforced_by_server_and_survives_cadence_change(memory_api):
    configure(memory_api, changesPerPeriod=1)
    assert start(memory_api).status_code == 201
    for number in range(9):
        add_transaction(memory_api, note=f"purchase {number}")
    assert get_state(memory_api)["current"]["completed"] is True
    assert start(memory_api).status_code == 409
    configure(memory_api, period="week")
    assert start(memory_api).status_code == 409
    assert get_state(memory_api)["period"]["remaining"] == 0


@pytest.mark.parametrize("body", [{"pieceCount": 8}, {"changesPerPeriod": 0}, {"changesPerPeriod": True},
                                   {"earnedPieces": 100}, {"wallName": " "}, {"timezone": "Not/AZone"}, {"period": "day"}])
def test_preference_validation_rejects_forged_rewards_and_invalid_values(memory_api, body):
    assert memory_api[0].patch("/api/memories/settings", headers=memory_api[5], json=body).status_code == 422


def test_failed_ledger_transaction_rolls_back_its_reward(memory_api):
    configure(memory_api)
    _api, me, _other, group, cat, _auth, _other_auth = memory_api
    with db.SessionLocal() as session:
        transaction = Transaction(user_id=me.id, group_id=group.id, category_id=cat.id,
                                  kind="expense", amount=100, occurred_on=date.today(), source="manual")
        session.add(transaction)
        session.flush()
        assert session.scalar(select(PuzzleEarning).where(PuzzleEarning.transaction_id == transaction.id)) is not None
        session.rollback()
    assert get_state(memory_api)["totalEarned"] == 0
    assert crud.count(Transaction) == 0


def test_nlp_batch_awards_each_confirmed_transaction_and_rejects_invalid_batch_atomically(memory_api):
    api, _me, _other, group, cat, auth, _other_auth = memory_api
    items = [{"span": f"早餐 {number}", "date": date.today().isoformat(), "amount": 55 + number,
              "kind": "expense", "cat": str(cat.id), "groupId": str(group.id),
              "orig": {"by": "rules"}} for number in range(3)]
    bad = [{**item} for item in items]
    bad[-1]["cat"] = "999999"
    assert api.post("/api/nlp/confirm-batch", headers=auth, json={"items": bad}).status_code == 400
    assert crud.count(PuzzleEarning) == 0 and crud.count(Transaction) == 0
    response = api.post("/api/nlp/confirm-batch", headers=auth, json={"items": items})
    assert response.status_code == 201, response.text
    assert response.json()["created"] == 3
    assert get_state(memory_api)["creditsAvailable"] == 3
    assert crud.count(PuzzleEarning) == crud.count(Transaction) == 3


def test_wall_background_is_private_replaceable_and_removable(memory_api):
    api, _me, _other, _group, _cat, auth, other_auth = memory_api
    response = api.put("/api/memories/wall-background", headers=auth,
                       files={"file": ("wall.png", picture(), "image/png")})
    assert response.status_code == 200, response.text
    url = response.json()["settings"]["wallBackgroundUrl"]
    assert api.get(url, headers=auth).status_code == 200
    assert api.get(url, headers=other_auth).status_code == 404
    assert api.delete("/api/memories/wall-background", headers=auth).status_code == 200
    assert api.get(url, headers=auth).status_code == 404


def test_deleted_provisional_piece_can_be_restored_after_replacement_completes_board(memory_api):
    configure(memory_api, changesPerPeriod=2)
    first = start(memory_api).json()["current"]
    removed = add_transaction(memory_api, note="provisional purchase")
    for number in range(7):
        add_transaction(memory_api, note=f"kept {number}")
    assert memory_api[0].delete(f"/api/transactions/{removed['id']}", headers=memory_api[5]).status_code == 200
    # No intervening memories GET: ledger writes must release the old slot.
    add_transaction(memory_api, note="replacement one")
    add_transaction(memory_api, note="replacement two")
    assert crud.get(PuzzleGame, first["id"]).completed_at is not None
    assert start(memory_api).status_code == 201
    add_transaction(memory_api, note="provisional purchase")
    state = get_state(memory_api)
    assert state["current"]["earnedPieces"] == 1
    assert state["creditsAvailable"] == 0 and state["totalEarned"] == 10
    with db.SessionLocal() as session:
        assigned = session.scalars(select(PuzzleEarning).where(PuzzleEarning.game_id == first["id"])).all()
        assert len(assigned) == 9


def test_visiting_active_puzzle_releases_deleted_piece_without_minting_new_credit(memory_api):
    configure(memory_api, changesPerPeriod=2)
    first = start(memory_api).json()["current"]
    removed = add_transaction(memory_api, note="removed before visit")
    assert memory_api[0].delete(f"/api/transactions/{removed['id']}", headers=memory_api[5]).status_code == 200
    assert get_state(memory_api)["current"]["earnedPieces"] == 0
    with db.SessionLocal() as session:
        original = session.scalar(select(PuzzleEarning))
        assert original.game_id is None and original.transaction_id is None
    for number in range(9):
        add_transaction(memory_api, note=f"replacement {number}")
    assert start(memory_api).status_code == 201
    add_transaction(memory_api, note="removed before visit")
    state = get_state(memory_api)
    assert state["current"]["earnedPieces"] == 1 and state["totalEarned"] == 10
    assert crud.get(PuzzleGame, first["id"]).earned_pieces == 9
