"""Neon runtime TLS must be verified even when the copied URI is weaker.

Driver interception proves the actual SQLAlchemy merge without a network call.
Other-provider connections and the existing pool policy remain unchanged.
"""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import event

from app.toolkit import db


NEON_URL = ('postgresql+psycopg://fixture_user:synthetic-secret@'
            'ep-runtime.us-west-2.aws.neon.tech/neondb')


class NoNetworkConnection(Exception):
    pass


def _capture_driver_kwargs(engine):
    captured = {}

    def stop_before_driver(dialect, connection_record, args, kwargs):
        captured.update(kwargs)
        raise NoNetworkConnection

    event.listen(engine, 'do_connect', stop_before_driver)
    try:
        with pytest.raises(NoNetworkConnection):
            engine.connect()
    finally:
        engine.dispose()
    return captured


def test_sqlalchemy_overrides_weaker_neon_url_before_any_network(monkeypatch, tmp_path):
    ca = tmp_path / 'trusted-system.pem'
    ca.write_text('synthetic CA path; no TLS connection is attempted')
    monkeypatch.setattr(db.ssl, 'get_default_verify_paths', lambda: SimpleNamespace(cafile=str(ca)))
    engine = db.make_engine(NEON_URL + '?sslmode=disable&channel_binding=disable&connect_timeout=90')
    assert engine.pool._pre_ping is True
    assert engine.pool._recycle == 300
    assert engine.pool.size() == db.settings.db_pool_size
    assert engine.pool._max_overflow == db.settings.db_pool_size
    values = _capture_driver_kwargs(engine)
    assert values['sslmode'] == 'verify-full'
    assert values['sslrootcert'] == str(ca)
    assert values['channel_binding'] == 'require'
    assert values['connect_timeout'] == 15
    assert values['host'] == 'ep-runtime.us-west-2.aws.neon.tech'
    assert values['dbname'] == 'neondb'


@pytest.mark.parametrize('host', ['ep-one.aws.neon.tech', 'EP-TWO.AWS.NEON.TECH'])
def test_valid_neon_suffix_receives_security_parameters(monkeypatch, tmp_path, host):
    ca = tmp_path / 'system.pem'; ca.write_text('fixture')
    monkeypatch.setattr(db.ssl, 'get_default_verify_paths', lambda: SimpleNamespace(cafile=str(ca)))
    assert db._neon_connect_args('postgresql+psycopg://u:p@' + host + '/data') == {
        'sslmode': 'verify-full', 'sslrootcert': str(ca),
        'channel_binding': 'require', 'connect_timeout': 15,
    }


@pytest.mark.parametrize('url', [
    'postgresql+psycopg://u:p@dpg-render-internal/data',
    'postgresql+psycopg://u:p@database.oregon-postgres.render.com/data',
    'postgresql+psycopg://u:p@db.example.test/data',
    'postgresql+psycopg://u:p@neon.tech/data',
    'postgresql+psycopg://u:p@evilneon.tech/data',
    'postgresql+psycopg://u:p@ep.neon.tech.example.test/data',
    'sqlite://',
    'mysql://u:p@ep.neon.tech/data',
])
def test_other_providers_do_not_even_read_a_neon_ca(monkeypatch, url):
    sentinel = Mock(side_effect=AssertionError('CA lookup for non-Neon provider'))
    monkeypatch.setattr(db.ssl, 'get_default_verify_paths', sentinel)
    monkeypatch.setattr(db.certifi, 'where', sentinel)
    assert db._neon_connect_args(url) == {}
    sentinel.assert_not_called()


def test_non_neon_driver_keeps_existing_ssl_options_and_pool_policy():
    engine = db.make_engine('postgresql+psycopg://u:synthetic-secret@db.example.test/data?sslmode=require&connect_timeout=7')
    assert engine.pool._pre_ping is True and engine.pool._recycle == 300
    values = _capture_driver_kwargs(engine)
    assert values['sslmode'] == 'require'
    assert values['connect_timeout'] == '7'
    assert 'sslrootcert' not in values and 'channel_binding' not in values


@pytest.mark.parametrize('system_path', [None, 'missing-system-ca.pem'])
def test_windows_or_absent_system_ca_uses_locked_certifi_bundle(monkeypatch, tmp_path, system_path):
    fallback = tmp_path / 'certifi.pem'; fallback.write_text('fixture')
    monkeypatch.setattr(db.ssl, 'get_default_verify_paths', lambda: SimpleNamespace(cafile=system_path))
    monkeypatch.setattr(db.certifi, 'where', lambda: str(fallback))
    assert db._neon_connect_args(NEON_URL)['sslrootcert'] == str(fallback)


def test_missing_all_ca_files_fails_before_engine_creation_and_without_secrets(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(db.ssl, 'get_default_verify_paths', lambda: SimpleNamespace(cafile=str(tmp_path / 'missing-system.pem')))
    monkeypatch.setattr(db.certifi, 'where', lambda: str(tmp_path / 'missing-certifi.pem'))
    engine_builder = Mock(side_effect=AssertionError('engine must not be created'))
    monkeypatch.setattr(db, 'create_engine', engine_builder)
    with pytest.raises(RuntimeError) as error:
        db.make_engine(NEON_URL)
    assert str(error.value) == 'Neon TLS trust store is unavailable'
    assert 'synthetic-secret' not in str(error.value) and 'neon.tech' not in str(error.value)
    engine_builder.assert_not_called()
    assert capsys.readouterr().out == ''


def test_system_ca_lookup_failure_can_use_certifi_without_weakening_tls(monkeypatch, tmp_path):
    fallback = tmp_path / 'certifi.pem'; fallback.write_text('fixture')
    monkeypatch.setattr(db.ssl, 'get_default_verify_paths', Mock(side_effect=OSError('fixture unavailable')))
    monkeypatch.setattr(db.certifi, 'where', lambda: str(fallback))
    values = db._neon_connect_args(NEON_URL)
    assert values['sslrootcert'] == str(fallback) and values['sslmode'] == 'verify-full'
