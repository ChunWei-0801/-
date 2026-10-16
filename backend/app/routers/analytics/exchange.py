"""國際匯率換算：公開參考行情，不寫入帳本、不呼叫 AI。

領域：數字
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.schemas.exchange import ConversionIn, ConversionOut, RatesOut
from app.services import exchange

router = APIRouter(tags=["匯率換算"])
OWNER = "數字"


@router.get("/exchange/rates", response_model=RatesOut, summary="取得國際參考匯率")
def rates(base: str = Query(default="USD", min_length=3, max_length=3), refresh: bool = False):
    """取得國際參考匯率

    GET /api/exchange/rates

    【這支做什麼】
        取得公開的真實國際參考匯率，依 base 換算貨幣表。優先使用
        ExchangeRate-API Open Access，失敗時讀取 currency-api 每日彙整。
        HTTPS 憑證驗證保持開啟；不使用寫死的行情或加密貨幣替代法定幣。

    【前端怎麼打】
        API.exchangeRates({base: 'USD', refresh: true})。
        換算頁顯示 rates 的幣別清單、來源、資料日期及 stale 警告。

    【誰能打】
        公開參考行情，登入前後皆可使用；不讀寫使用者資料。

    【查詢參數】
        base：3 碼 ISO 貨幣代碼，預設 USD，支援大小寫。
        refresh：預設 false；true 請求重新讀取來源，最短間隔 60 秒。

    【成功回應】
        200，所有金額／匯率透過 JSON 字串保留 Decimal 精度。
        {base: 'USD', rates: {USD: '1', ...}, provider, sourceUrl,
         updatedAt, updatePrecision, nextUpdateAt, fetchedAt, stale, warning}。
        updatedAt 每日來源為 YYYY-MM-DD，不捏造精確發布時間。
        stale 為 true 表示來源更新失敗或資料較舊，請核對日期。

    【錯誤回應】
        422：未知或來源未提供的幣別、無效查詢參數。
        503：來源無法連線或沒有 48 小時以內的行情；Retry-After: 60。

    【會用到的資料表】
        無；不需要資料庫，不保存外部行情為帳本交易。

    【每一步用的工具與資料庫方法】
        exchange.normalize_currency：驗證法定貨幣代碼。
        exchange.get_rates：讀取有限快取或 HTTPS 來源，以 Decimal 計算交叉匯率。
        HTTPException：回報可讀的 422／503，不隱藏來源失敗。

    【寫法步驟】
        1. 驗證 base，取得資料新鮮度與來源。
        2. 按基準幣別重算匯率表，保留 Decimal。
        3. 成功回傳來源資料；不可用時明示錯誤，不生成假行情。

    【完整寫法】
        第一步：檔案共用 import。

            from fastapi import APIRouter, HTTPException, Query

            from app.schemas.exchange import ConversionIn, ConversionOut, RatesOut
            from app.services import exchange

        第二步：函式內容。

            try:
                return exchange.get_rates(base, refresh=refresh)
            except exchange.UnsupportedCurrency as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except exchange.RatesUnavailable as exc:
                raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "60"}) from exc

    【做完怎麼確認】
        tests/test_exchange.py 驗證交叉匯率、快取、來源故障與日期過期。
        實際連線需取得來源回應，核對 provider 與 updatedAt；不把 mock
        測試數字宣稱為真實國際行情。
    """
    try:
        return exchange.get_rates(base, refresh=refresh)
    except exchange.UnsupportedCurrency as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except exchange.RatesUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "60"}) from exc


@router.post("/exchange/convert", response_model=ConversionOut, summary="換算貨幣金額")
def convert(body: ConversionIn):
    """換算貨幣金額

    POST /api/exchange/convert

    【這支做什麼】
        使用國際參考匯率，以 Decimal 計算來源金額 × 交叉匯率。
        依目標貨幣小數位四捨五入；參考匯率非銀行成交價，不含手續費。
        換算不寫入帳本；帳本維持 TWD，需使用者確認後再手動新增。

    【前端怎麼打】
        API.exchangeConvert({amount: '100', fromCurrency: 'USD', toCurrency: 'TWD'})。
        只在 TWD 結果可帶入手動記帳，並保留原始金額、匯率與資料日期於 note。

    【誰能打】
        公開換算功能，登入前後皆可使用，不需外部 API 金鑰。

    【請求主體】
        amount：0 或正數，最多 10 位小數，上限 1000000000000000。
        fromCurrency、toCurrency：3 碼法定幣代碼，接受大小寫。
        額外欄位、負數、NaN、Infinity 與布林金額均拒絕。

    【成功回應】
        200，amount、rate、convertedAmount 為保留精度的 JSON 字串。
        {amount, fromCurrency, toCurrency, rate, convertedAmount, decimalPlaces,
         provider, sourceUrl, updatedAt, updatePrecision, nextUpdateAt,
         fetchedAt, stale, warning}。
        rate 是 1 單位來源幣別可換得多少目標幣別；相同幣別 rate = 1。
        JPY 等 0 位、TWD／USD 等 2 位、KWD 等 3 位小數。

    【錯誤回應】
        422：金額格式或範圍不符，幣別未知或來源沒有該幣別。
        503：來源不可用且沒有 48 小時內行情；Retry-After: 60。

    【會用到的資料表】
        無；此 API 是換算器，帳本新增仍走 POST /api/transactions。

    【每一步用的工具與資料庫方法】
        ConversionIn：有限、非負 Decimal 金額及幣別格式驗證。
        exchange.convert：取得行情，除出交叉匯率，ROUND_HALF_UP 四捨五入。
        ConversionOut：保留精度和來源，標示 stale 與 warning。

    【寫法步驟】
        1. 請求主體驗證金額與幣別；確認來源提供行情。
        2. Decimal 計算及四捨五入，附上來源、日期和新鮮度。
        3. 無可用行情回 503；未知幣別回 422，不自動新增交易。

    【完整寫法】
        第一步：檔案共用 import。

            from fastapi import APIRouter, HTTPException, Query

            from app.schemas.exchange import ConversionIn, ConversionOut, RatesOut
            from app.services import exchange

        第二步：函式內容。

            try:
                return exchange.convert(body)
            except exchange.UnsupportedCurrency as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except exchange.RatesUnavailable as exc:
                raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "60"}) from exc

    【做完怎麼確認】
        tests/test_exchange.py 驗證 USD↔TWD、相同幣別、零金額、捨入及異常輸入。
        手機與電腦均需看到參考匯率、日期、來源；TWD 帶入後由使用者核對
        實付金額及備註，再確認記帳，避免將估算誤認成實際成交。
    """
    try:
        return exchange.convert(body)
    except exchange.UnsupportedCurrency as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except exchange.RatesUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "60"}) from exc
