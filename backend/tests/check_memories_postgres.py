"""Explicit local PostgreSQL concurrency check; never touches existing tables.

Run ``python -m tests.check_memories_postgres`` from backend/ with
MEMORIES_TEST_DATABASE_URL set to a local development PostgreSQL connection.
The script creates and removes its own random schema.
It is intentionally outside automatic pytest collection (which uses SQLite).
"""

import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import event, func, select, text
from sqlalchemy.engine import make_url

from app.main import app
from app.models import Category, Group, GroupMember, Transaction, User
from app.models.memories import PuzzleEarning, PuzzleGame, PuzzleSettings, TransactionPhoto
from app.services import memories
from app.toolkit import crud, db, tokens
from app.toolkit.config import settings

settings.app_env = 'development'
settings.require_email_verification = False
schema = 'memory_concurrency_' + uuid4().hex
original_url = os.environ.get('MEMORIES_TEST_DATABASE_URL')
if not original_url:
    raise SystemExit('Set MEMORIES_TEST_DATABASE_URL to a local development PostgreSQL URL.')
target = make_url(original_url)
if target.host not in {'localhost', '127.0.0.1', '::1', 'db'} or not target.drivername.startswith('postgresql'):
    raise SystemExit('This check only supports a local development PostgreSQL server.')
root_engine = db.make_engine(original_url)
with root_engine.begin() as connection:
    connection.execute(text('CREATE SCHEMA ' + schema))
url = make_url(original_url).update_query_dict({'options': '-csearch_path=' + schema})
results = {}
try:
    db.use_database(url.render_as_string(hide_password=False))
    db.create_all()
    me = crud.save(User, {'email': 'concurrency@example.com', 'display_name': 'Concurrency', 'password_hash': 'unused', 'theme': 'paper'})
    cat = crud.save(Category, {'name': '餐飲', 'kind': 'expense', 'color': 'cat-food'})
    groups = []
    for number in range(12):
        group = crud.save(Group, {'name': 'Book ' + str(number), 'created_by': me.id})
        crud.save(GroupMember, {'user_id': me.id, 'group_id': group.id})
        groups.append(group)
    auth = {'Authorization': 'Bearer ' + tokens.make_access_token(me.id)}
    buf = io.BytesIO()
    Image.new('RGB', (160, 120), 'green').save(buf, 'PNG')
    photo = buf.getvalue()
    with TestClient(app) as api, ThreadPoolExecutor(max_workers=8) as pool:
        def add(number):
            response = api.post('/api/transactions', headers=auth, json={
                'date': date.today().isoformat(), 'amount': 100 + number, 'kind': 'expense',
                'cat': str(cat.id), 'groupId': str(groups[number].id), 'note': 'Concurrent ' + str(number)})
            assert response.status_code == 201, response.text
            return response.json()
        # Distinct ledgers avoid accidentally serializing on the ledger lock;
        # all eight first transactions race to create one settings row.
        transactions = list(pool.map(add, range(8)))
        assert crud.count(PuzzleSettings) == 1
        assert crud.count(PuzzleEarning) == 8
        assert api.get('/api/memories', headers=auth).json()['creditsAvailable'] == 8
        results['first_transaction_settings_race'] = '8 committed, 1 settings, 8 rewards'
        assert api.patch('/api/memories/settings', headers=auth, json={'pieceCount': 9, 'changesPerPeriod': 31}).status_code == 200
        def start(_):
            return api.post('/api/memories/puzzles', headers=auth, files={'file': ('picture.png', photo, 'image/png')})
        started = list(pool.map(start, range(2)))
        assert sorted(item.status_code for item in started) == [201, 409], [item.text for item in started]
        game = next(item.json()['current'] for item in started if item.status_code == 201)
        assert game['earnedPieces'] == 8
        results['simultaneous_first_puzzle'] = [item.status_code for item in started]
        # Both new records finish the same board; exactly one surplus remains.
        list(pool.map(add, [8, 9]))
        state = api.get('/api/memories', headers=auth).json()
        assert state['current']['completed'] and state['current']['earnedPieces'] == 9
        assert state['creditsAvailable'] == 1 and state['totalEarned'] == 10
        with db.SessionLocal() as session:
            first = session.get(PuzzleGame, game['id'])
            assert first.completed_at is not None
            assert session.scalar(select(func.count()).select_from(PuzzleEarning).where(PuzzleEarning.game_id == game['id'])) == 9
        results['simultaneous_last_pieces'] = '9 allocated, 1 banked, completion durable'
        next_games = list(pool.map(start, range(2)))
        assert sorted(item.status_code for item in next_games) == [201, 409], [item.text for item in next_games]
        assert crud.count(PuzzleGame) == 2
        results['simultaneous_next_puzzle'] = [item.status_code for item in next_games]
        transaction_id = transactions[0]['id']
        def upload(_):
            return api.post('/api/transactions/' + transaction_id + '/photos', headers=auth,
                            files={'file': ('picture.png', photo, 'image/png')})
        uploaded = list(pool.map(upload, range(6)))
        assert sorted(item.status_code for item in uploaded) == [201, 201, 201, 201, 409, 409], [item.text for item in uploaded]
        assert crud.count(TransactionPhoto) == 4
        results['simultaneous_photo_limit'] = [item.status_code for item in uploaded]
        assert api.delete('/api/transactions/' + transaction_id, headers=auth).status_code == 200
        assert crud.count(TransactionPhoto) == 0
        add(0)
        state = api.get('/api/memories', headers=auth).json()
        assert state['totalEarned'] == 10 and state['creditsAvailable'] == 0
        assert state['current']['earnedPieces'] == 1
        assert crud.count(PuzzleEarning) == 10
        results['delete_recreate_durable_tombstone'] = 'no extra credit; photos cascade'
        # A ledger deletion and the final piece must have a consistent order.
        # Pause at the completion timestamp after the service has counted its
        # last piece. Deleting an earlier entry must wait until this snapshot
        # commits, rather than erase a counted piece before completion is saved.
        def add_more(number, group_number=11):
            response = api.post('/api/transactions', headers=auth, json={
                'date': date.today().isoformat(), 'amount': number, 'kind': 'expense',
                'cat': str(cat.id), 'groupId': str(groups[group_number].id),
                'note': 'Completion race ' + str(number)})
            assert response.status_code == 201, response.text
            return response.json()
        more = [add_more(number) for number in range(1000, 1007)]
        assert api.get('/api/memories', headers=auth).json()['current']['earnedPieces'] == 8
        at_completion, release_completion, delete_attempted = Event(), Event(), Event()
        real_now = memories.utcnow
        clock_calls = 0
        def hold_completion():
            global clock_calls
            clock_calls += 1
            if clock_calls == 2:
                at_completion.set()
                assert release_completion.wait(10), 'Completion gate timed out'
            return real_now()
        def watch_delete(_conn, _cursor, statement, _parameters, _context, _executemany):
            if statement.startswith('DELETE FROM transactions'):
                delete_attempted.set()
        event.listen(db.engine, 'before_cursor_execute', watch_delete)
        memories.utcnow = hold_completion
        try:
            final_piece = pool.submit(add_more, 1007, 10)
            assert at_completion.wait(5), 'Final ledger write never reached completion'
            deletion = pool.submit(api.delete, '/api/transactions/' + more[0]['id'], headers=auth)
            assert delete_attempted.wait(5), 'Concurrent deletion did not reach the database'
            deletion_finished = Event()
            deletion.add_done_callback(lambda _future: deletion_finished.set())
            assert not deletion_finished.wait(0.2), 'Deletion bypassed the piece snapshot lock'
            release_completion.set()
            final_piece.result(timeout=5)
            deleted = deletion.result(timeout=5)
            assert deleted.status_code == 200, deleted.text
        finally:
            release_completion.set()
            memories.utcnow = real_now
            event.remove(db.engine, 'before_cursor_execute', watch_delete)
        state = api.get('/api/memories', headers=auth).json()
        assert state['current']['completed'] and state['current']['earnedPieces'] == 9
        results['delete_during_last_piece_snapshot'] = 'deletion waits; completed achievement remains immutable'
    print(json.dumps(results, ensure_ascii=False, indent=2))
finally:
    db.engine.dispose()
    with root_engine.begin() as connection:
        connection.execute(text('DROP SCHEMA ' + schema + ' CASCADE'))
    root_engine.dispose()
