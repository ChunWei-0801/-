"""真實公開行情、有限快取與十進位換算，不提供虛構的備援行情。

領域：數字

優先 ExchangeRate-API Open Access；失敗時使用 currency-api 每日彙整。
來源故障只能沿用不超過 48 小時的既有資料，並明示 stale。
來源 HTTPS 憑證由 httpx 正常驗證，沒有金鑰或使用者資料送往來源。
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext

import httpx

from app.schemas.exchange import ConversionIn, ConversionOut, RatesOut

log = logging.getLogger(__name__)

PRIMARY_URL = "https://open.er-api.com/v6/latest/USD"
FALLBACK_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"
CACHE_TTL_SECONDS = 3600
MIN_REFRESH_SECONDS = 60
MAX_QUOTE_AGE = timedelta(hours=48)
STALE_QUOTE_AGE = timedelta(hours=36)

# Current legal currencies only: the aggregate also contains crypto, metals and
# historical currency codes, which must not enter the fiat currency selector.
FIAT_CURRENCIES = frozenset("""
AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN BWP
BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD
FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD
JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD
MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK
PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP
STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV
WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG
""".split())
ZERO_DECIMAL = frozenset("BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF".split())
THREE_DECIMAL = frozenset("BHD IQD JOD KWD LYD OMR TND".split())


class RatesUnavailable(RuntimeError):
    pass


class UnsupportedCurrency(ValueError):
    pass


@dataclass(frozen=True)
class Snapshot:
    rates: dict[str, Decimal]
    provider: str
    source_url: str
    updated_at: str
    as_of: datetime
    precision: str
    next_update_at: str | None
    fetched_at: datetime
    warning: str | None = None


_snapshot: Snapshot | None = None
_last_attempt = float("-inf")
_last_refresh_failed = False
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_json(url: str) -> dict:
    # Fixed destinations, no redirects, bounded time and payload. Normal TLS
    # verification and environment proxy settings remain enabled.
    with httpx.Client(timeout=httpx.Timeout(8.0, connect=4.0), follow_redirects=False) as client:
        with client.stream("GET", url, headers={"Accept": "application/json"}) as response:
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 512_000:
                    raise ValueError("匯率來源回應超過合理大小")
    payload = json.loads(body, parse_float=Decimal, parse_int=Decimal)
    if not isinstance(payload, dict):
        raise ValueError("匯率來源回應格式錯誤")
    return payload


def _clean_rates(values) -> dict[str, Decimal]:
    if not isinstance(values, dict):
        raise ValueError("匯率來源沒有貨幣表")
    rates = {}
    for currency, value in values.items():
        code = str(currency).upper()
        if code not in FIAT_CURRENCIES:
            continue
        if isinstance(value, bool):
            raise ValueError("匯率來源含無效數值")
        rate = Decimal(str(value))
        if not rate.is_finite() or rate < Decimal("1e-12") or rate > Decimal("1e12"):
            raise ValueError("匯率來源含無效數值")
        rates[code] = rate
    required = {"USD", "TWD", "EUR", "JPY", "GBP", "CNY", "KRW", "HKD", "THB", "VND"}
    if not required.issubset(rates) or rates["USD"] != 1:
        raise ValueError("匯率來源缺少必要貨幣或基準幣不符")
    return rates


def _validate_age(value: datetime, now: datetime) -> None:
    if value > now + timedelta(minutes=5) or now - value > MAX_QUOTE_AGE:
        raise ValueError("匯率來源日期已過期或超前")


def _load_primary(now: datetime) -> Snapshot:
    data = _read_json(PRIMARY_URL)
    if data.get("result") != "success" or data.get("base_code") != "USD":
        raise ValueError("主要匯率來源尚未提供有效行情")
    as_of = datetime.fromtimestamp(int(data["time_last_update_unix"]), timezone.utc)
    _validate_age(as_of, now)
    next_at = data.get("time_next_update_unix")
    return Snapshot(
        rates=_clean_rates(data.get("rates")), provider="ExchangeRate-API Open Access",
        source_url="https://www.exchangerate-api.com", updated_at=_iso(as_of), as_of=as_of,
        precision="second", next_update_at=_iso(datetime.fromtimestamp(int(next_at), timezone.utc)) if next_at else None,
        fetched_at=now,
    )


def _load_fallback(now: datetime) -> Snapshot:
    data = _read_json(FALLBACK_URL)
    # The aggregate publishes a date, not a precise publication time. Midnight
    # is used only for conservative internal freshness checks, never claimed
    # as an actual quote timestamp in the API or UI.
    as_of = datetime.strptime(data["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    _validate_age(as_of, now)
    return Snapshot(
        rates=_clean_rates(data.get("usd")), provider="currency-api 每日彙整（備援）",
        source_url="https://github.com/fawazahmed0/exchange-api", updated_at=data["date"],
        as_of=as_of, precision="day", next_update_at=None, fetched_at=now,
        warning="主要來源暫時無法連線，使用 currency-api 每日彙整參考匯率；非銀行即時成交價。",
    )


def _get_snapshot(*, refresh: bool = False) -> tuple[Snapshot, bool]:
    global _snapshot, _last_attempt, _last_refresh_failed
    with _lock:
        now, tick = _now(), time.monotonic()
        usable = _snapshot is not None and now - _snapshot.as_of <= MAX_QUOTE_AGE
        cached_recently = usable and (now - _snapshot.fetched_at).total_seconds() < CACHE_TTL_SECONDS
        throttled = tick - _last_attempt < MIN_REFRESH_SECONDS
        if (cached_recently and not refresh) or (usable and throttled):
            return _snapshot, _last_refresh_failed or now - _snapshot.as_of > STALE_QUOTE_AGE
        if throttled:
            raise RatesUnavailable("匯率來源暫時無法連線，請稍後重試；目前沒有可用行情。")
        _last_attempt = tick
        for name, loader in (("primary", _load_primary), ("daily aggregate", _load_fallback)):
            try:
                _snapshot = loader(now)
                _last_refresh_failed = False
                return _snapshot, now - _snapshot.as_of > STALE_QUOTE_AGE
            except (httpx.HTTPError, ValueError, KeyError, TypeError, InvalidOperation, OverflowError) as exc:
                # Log only the failure category and fixed source name. No raw
                # proxy output, connection credentials or response payloads.
                log.warning("Exchange rate source %s unavailable (%s)", name, type(exc).__name__)
        _last_refresh_failed = True
        if usable:
            return _snapshot, True
        raise RatesUnavailable("無法取得國際參考匯率，請稍後重新整理；系統不會使用虛構行情。")


def normalize_currency(value: str) -> str:
    code = value.strip().upper()
    if code not in FIAT_CURRENCIES:
        raise UnsupportedCurrency(f"不支援幣別 {code}，請選擇清單中的國際貨幣代碼。")
    return code


def _require_currency(code: str, snapshot: Snapshot) -> None:
    if code not in snapshot.rates:
        raise UnsupportedCurrency(f"匯率來源目前未提供 {code} 行情，請選擇清單中的幣別。")


def _metadata(snapshot: Snapshot, stale: bool) -> dict:
    warning = snapshot.warning
    if stale:
        warning = "匯率更新失敗或資料日期較舊，正在使用先前行情；請核對資料日期後再使用。" + (" " + warning if warning else "")
    return {
        "provider": snapshot.provider, "sourceUrl": snapshot.source_url,
        "updatedAt": snapshot.updated_at, "updatePrecision": snapshot.precision,
        "nextUpdateAt": snapshot.next_update_at, "fetchedAt": _iso(snapshot.fetched_at),
        "stale": stale, "warning": warning,
    }


def get_rates(base: str = "USD", *, refresh: bool = False) -> RatesOut:
    base = normalize_currency(base)
    snapshot, stale = _get_snapshot(refresh=refresh)
    _require_currency(base, snapshot)
    with localcontext() as context:
        context.prec = 50
        rates = {code: rate / snapshot.rates[base] for code, rate in snapshot.rates.items()}
    return RatesOut(base=base, rates=rates, **_metadata(snapshot, stale))


def convert(body: ConversionIn) -> ConversionOut:
    source, target = normalize_currency(body.fromCurrency), normalize_currency(body.toCurrency)
    snapshot, stale = _get_snapshot()
    _require_currency(source, snapshot)
    _require_currency(target, snapshot)
    places = 0 if target in ZERO_DECIMAL else 3 if target in THREE_DECIMAL else 2
    with localcontext() as context:
        context.prec = 50
        rate = snapshot.rates[target] / snapshot.rates[source]
        converted = (body.amount * rate).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    return ConversionOut(
        amount=body.amount, fromCurrency=source, toCurrency=target,
        rate=rate, convertedAmount=converted, decimalPlaces=places, **_metadata(snapshot, stale),
    )
