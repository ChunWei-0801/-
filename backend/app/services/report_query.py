"""Exact authorized reports and genuine OOXML exports; no model or write path.

領域：數字

Filtering is bound SQL expression data, never SQL from a model. Summary-only
supervision cannot be converted to searchable individual transaction evidence.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal, localcontext
from io import BytesIO
from urllib.parse import urlencode
import re
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.guards import visible_scope
from app.models import Category, Group, Guardianship, Transaction, User
from app.schemas.report_query import ReportFilters, ReportQuery

MAX_EXPORT_ROWS = 10000
MAX_EXPORT_TEXT_BYTES = 8_000_000
MATCH_FIELDS = ["merchant", "note", "activity"]
_HEADERS = ["日期", "收支", "金額（TWD）", "分類", "商家", "備註", "活動"]
_KIND = {"expense": "支出", "income": "收入"}
_XML_INVALID = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def _dates(query: ReportFilters) -> tuple[date, date]:
    month = query.month
    return (date(query.year, month or 1, 1),
            date(query.year, month or 12, monthrange(query.year, month or 12)[1]))


def _scope(db: Session, me: User, query: ReportFilters) -> tuple[set[int], dict]:
    visible, _ = visible_scope(me, db)
    people = set(visible) if query.scope == "family" else {me.id}
    excluded: set[int] = set()
    if query.scope == "family":
        grants = list(db.execute(select(Guardianship.ward_id, Guardianship.scope).where(
            Guardianship.guardian_id == me.id, Guardianship.ended_at.is_(None))))
        full = {uid for uid, scope in grants if scope in ("all", "全部明細")}
        excluded = ({uid for uid, _ in grants} - full - {me.id}) & people
        people -= excluded
    return people, {
        "includedPeople": len(people), "excludedSummaryOnlyPeople": len(excluded),
        "authorizationLimited": bool(excluded),
        "definition": ("僅目前登入者的全部個人明細。" if query.scope == "me" else
                       "本人、可見家庭家長與獲授權完整明細的監管對象；僅摘要對象及共用活動的其他人不納入。"),
    }


def _conditions(people: set[int], query: ReportFilters):
    start, end = _dates(query)
    conditions = [Transaction.user_id.in_(people), Transaction.occurred_on.between(start, end),
                  Transaction.kind.in_(("income", "expense"))]
    if query.kind != "all":
        conditions.append(Transaction.kind == query.kind)
    if query.q:
        word = query.q.lower()
        activities = select(Group.id).where(func.lower(Group.name).contains(word, autoescape=True))
        conditions.append(or_(
            func.lower(func.coalesce(Transaction.merchant, "")).contains(word, autoescape=True),
            func.lower(func.coalesce(Transaction.note, "")).contains(word, autoescape=True),
            Transaction.group_id.in_(activities),
        ))
    return conditions


def _totals(db: Session, conditions) -> dict:
    income, expense, count = Decimal("0.00"), Decimal("0.00"), 0
    # SQLite SUM returns binary floating point; Decimal stream is exact on both
    # supported databases and never treats the current evidence page as totals.
    statement = select(Transaction.kind, Transaction.amount).where(*conditions).execution_options(yield_per=500)
    with localcontext() as context:
        context.prec = 40
        for kind, amount in db.execute(statement):
            count += 1
            if kind == "income":
                income += amount
            else:
                expense += amount
        return {"income": format(income, ".2f"), "expense": format(expense, ".2f"),
                "net": format(income - expense, ".2f"), "count": count}


def _rows(db: Session, conditions, limit: int, offset: int) -> list[dict]:
    statement = select(Transaction.id, Transaction.occurred_on, Transaction.kind,
                       Transaction.amount, Category.name, Transaction.merchant,
                       Transaction.note, Group.name.label("activity_name")).outerjoin(
                           Category, Category.id == Transaction.category_id).outerjoin(
                           Group, Group.id == Transaction.group_id).where(*conditions).order_by(
                               Transaction.occurred_on.desc(), Transaction.id.desc()).limit(limit).offset(offset)
    return [{"id": str(tid), "date": occurred.isoformat(), "kind": kind,
             "amount": format(amount, ".2f"), "categoryName": category or "",
             "merchant": merchant or "", "note": note or "", "activityName": activity or ""}
            for tid, occurred, kind, amount, category, merchant, note, activity in db.execute(statement)]


def _base(db: Session, me: User, query: ReportFilters, *, calculate_totals: bool = True):
    people, scope_info = _scope(db, me, query)
    conditions = _conditions(people, query)
    start, end = _dates(query)
    filters = {"year": query.year, "month": query.month, "q": query.q,
               "kind": query.kind, "scope": query.scope, "from": start.isoformat(), "to": end.isoformat(),
               "matchFields": MATCH_FIELDS}
    return conditions, {"filters": filters, "scopeInfo": scope_info, "currency": "TWD",
                        "totals": _totals(db, conditions) if calculate_totals else None,
                        "dataPolicy": {"readOnly": True, "totalsComplete": True,
                                       "definition": "合計涵蓋此明確授權範圍與篩選條件的全部明細；地點只比對已記錄的商家、備註與活動文字，非GPS定位。"}}


def report(db: Session, me: User, query: ReportQuery) -> dict:
    conditions, result = _base(db, me, query)
    items = _rows(db, conditions, query.limit, query.offset)
    count = result["totals"]["count"]
    result["transactions"] = {"items": items, "returnedCount": len(items), "totalCount": count,
                              "limit": query.limit, "offset": query.offset,
                              "hasMore": query.offset + len(items) < count, "truncated": len(items) < count}
    source_query = query.model_dump(exclude_none=True)
    result["sources"] = [{"id": "report:exact", "title": "授權範圍完整篩選與精確合計",
                          "link": "/api/ai-local/report?" + urlencode(source_query)}]
    return result


def _text(value) -> str:
    return _XML_INVALID.sub("\ufffd", str(value))


def _xml(element: ET.Element) -> bytes:
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def _zip(files: dict[str, bytes]) -> bytes:
    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    return stream.getvalue()


def _types(overrides: dict[str, str]) -> bytes:
    namespace = "http://schemas.openxmlformats.org/package/2006/content-types"
    root = ET.Element("Types", xmlns=namespace)
    ET.SubElement(root, "Default", Extension="rels", ContentType="application/vnd.openxmlformats-package.relationships+xml")
    ET.SubElement(root, "Default", Extension="xml", ContentType="application/xml")
    for name, mime in overrides.items():
        ET.SubElement(root, "Override", PartName=name, ContentType=mime)
    return _xml(root)


def _rels(items: list[tuple[str, str, str]]) -> bytes:
    root = ET.Element("Relationships", xmlns="http://schemas.openxmlformats.org/package/2006/relationships")
    for identifier, kind, target in items:
        ET.SubElement(root, "Relationship", Id=identifier, Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/" + kind, Target=target)
    return _xml(root)


def _summary(result: dict) -> list[list[str]]:
    filters = result["filters"]
    return [["家庭記帳報表", ""], ["日期範圍", filters["from"] + " 至 " + filters["to"]],
            ["搜尋文字", filters["q"]], ["收支篩選", _KIND.get(filters["kind"], "全部收支")],
            ["資料範圍", result["scopeInfo"]["definition"]],
            ["摘要權限排除人數", str(result["scopeInfo"]["excludedSummaryOnlyPeople"])],
            ["符合筆數", str(result["totals"]["count"])],
            ["收入（TWD，精確文字）", result["totals"]["income"]],
            ["支出（TWD，精確文字）", result["totals"]["expense"]],
            ["結餘（TWD，精確文字）", result["totals"]["net"]],
            ["搜尋說明", result["dataPolicy"]["definition"]]]


def _values(row: dict) -> list[str]:
    return [row["date"], _KIND[row["kind"]], row["amount"], row["categoryName"], row["merchant"], row["note"], row["activityName"]]


def _xlsx(rows: list[dict], result: dict) -> bytes:
    namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    relation_namespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    def sheet(values, numeric_column=None):
        root = ET.Element("worksheet", xmlns=namespace)
        data = ET.SubElement(root, "sheetData")
        for row_index, cells in enumerate(values, 1):
            row = ET.SubElement(data, "row", r=str(row_index))
            for index, value in enumerate(cells):
                reference = chr(65 + index) + str(row_index)
                if row_index > 1 and index == numeric_column:
                    cell = ET.SubElement(row, "c", r=reference, t="n", s="1")
                    ET.SubElement(cell, "v").text = _text(value)
                else:
                    # Inline strings cannot become formulas, DDE or hyperlinks,
                    # even if a merchant/note starts with =, +, -, @ or tabs.
                    cell = ET.SubElement(row, "c", r=reference, t="inlineStr")
                    ET.SubElement(ET.SubElement(cell, "is"), "t", {"{http://www.w3.org/XML/1998/namespace}space": "preserve"}).text = _text(value)
        return _xml(root)
    workbook = ET.Element("workbook", xmlns=namespace, attrib={"xmlns:r": relation_namespace})
    sheets = ET.SubElement(workbook, "sheets")
    for index, name in enumerate(["收支明細", "報表摘要"], 1):
        ET.SubElement(sheets, "sheet", name=name, sheetId=str(index), attrib={"r:id": "rId" + str(index)})
    styles = ET.Element("styleSheet", xmlns=namespace)
    fonts = ET.SubElement(styles, "fonts", count="1");ET.SubElement(fonts, "font")
    fills = ET.SubElement(styles, "fills", count="2")
    for pattern in ["none", "gray125"]: ET.SubElement(ET.SubElement(fills, "fill"), "patternFill", patternType=pattern)
    borders = ET.SubElement(styles, "borders", count="1");ET.SubElement(borders, "border")
    formats = ET.SubElement(styles, "cellStyleXfs", count="1");ET.SubElement(formats, "xf", numFmtId="0", fontId="0", fillId="0", borderId="0")
    cell_formats = ET.SubElement(styles, "cellXfs", count="2")
    for code in ["0", "2"]: ET.SubElement(cell_formats, "xf", numFmtId=code, fontId="0", fillId="0", borderId="0", xfId="0")
    cell_styles = ET.SubElement(styles, "cellStyles", count="1")
    ET.SubElement(cell_styles, "cellStyle", name="Normal", xfId="0", builtinId="0")
    content = "application/vnd.openxmlformats-officedocument.spreadsheetml."
    return _zip({
        "[Content_Types].xml": _types({"/xl/workbook.xml": content + "sheet.main+xml", "/xl/worksheets/sheet1.xml": content + "worksheet+xml", "/xl/worksheets/sheet2.xml": content + "worksheet+xml", "/xl/styles.xml": content + "styles+xml"}),
        "_rels/.rels": _rels([("rId1", "officeDocument", "xl/workbook.xml")]),
        "xl/workbook.xml": _xml(workbook),
        "xl/_rels/workbook.xml.rels": _rels([("rId1", "worksheet", "worksheets/sheet1.xml"), ("rId2", "worksheet", "worksheets/sheet2.xml"), ("rId3", "styles", "styles.xml")]),
        "xl/styles.xml": _xml(styles), "xl/worksheets/sheet1.xml": sheet([_HEADERS] + [_values(row) for row in rows], 2),
        "xl/worksheets/sheet2.xml": sheet(_summary(result)),
    })


def _docx(rows: list[dict], result: dict) -> bytes:
    namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    q = lambda name: "{" + namespace + "}" + name
    document = ET.Element(q("document"));body = ET.SubElement(document, q("body"))
    def text(parent, value):
        paragraph = ET.SubElement(parent, q("p"));run = ET.SubElement(paragraph, q("r"))
        for index, line in enumerate(_text(value).split("\n")):
            if index: ET.SubElement(run, q("br"))
            ET.SubElement(run, q("t"), {"{http://www.w3.org/XML/1998/namespace}space": "preserve"}).text = line
    for values in _summary(result): text(body, "：".join(values).rstrip("："))
    table = ET.SubElement(body, q("tbl"))
    table_properties = ET.SubElement(table, q("tblPr"))
    ET.SubElement(table_properties, q("tblW"), {q("w"): "13900", q("type"): "dxa"})
    grid = ET.SubElement(table, q("tblGrid"))
    widths = [1500, 1000, 1600, 1600, 2300, 3900, 2000]
    for width in widths: ET.SubElement(grid, q("gridCol"), {q("w"): str(width)})
    for row_index, values in enumerate([_HEADERS] + [_values(row) for row in rows]):
        row = ET.SubElement(table, q("tr"))
        if row_index == 0: ET.SubElement(ET.SubElement(row, q("trPr")), q("tblHeader"))
        for value, width in zip(values, widths):
            cell = ET.SubElement(row, q("tc"))
            ET.SubElement(ET.SubElement(cell, q("tcPr")), q("tcW"), {q("w"): str(width), q("type"): "dxa"})
            text(cell, value)
    properties = ET.SubElement(body, q("sectPr"))
    ET.SubElement(properties, q("pgSz"), {q("w"): "16838", q("h"): "11906", q("orient"): "landscape"})
    return _zip({"[Content_Types].xml": _types({"/word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"}),
                 "_rels/.rels": _rels([("rId1", "officeDocument", "word/document.xml")]),
                 "word/document.xml": _xml(document)})


def export(db: Session, me: User, query: ReportFilters, export_format: str) -> tuple[bytes, str, str]:
    conditions, result = _base(db, me, query, calculate_totals=False)
    # One statement supplies all exported details and their totals. This avoids
    # summing one snapshot and exporting another if entries change concurrently.
    rows = _rows(db, conditions, MAX_EXPORT_ROWS + 1, 0)
    if len(rows) > MAX_EXPORT_ROWS:
        raise HTTPException(status_code=413, detail="符合資料超過單檔10,000筆上限，請縮小年月或搜尋條件；未匯出任何部分資料。")
    if sum(len(value.encode("utf-8")) for row in rows for value in _values(row)) > MAX_EXPORT_TEXT_BYTES:
        raise HTTPException(status_code=413, detail="符合資料的文字內容超過單檔上限，請縮小年月或搜尋條件；未匯出任何部分資料。")
    with localcontext() as context:
        context.prec = 40
        income = sum((Decimal(row["amount"]) for row in rows if row["kind"] == "income"), Decimal("0.00"))
        expense = sum((Decimal(row["amount"]) for row in rows if row["kind"] == "expense"), Decimal("0.00"))
        result["totals"] = {"income": format(income, ".2f"), "expense": format(expense, ".2f"), "net": format(income - expense, ".2f"), "count": len(rows)}
    period = str(query.year) + ("-%02d" % query.month if query.month else "")
    if export_format == "xlsx":
        return _xlsx(rows, result), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "fambudget-report-" + period + ".xlsx"
    return _docx(rows, result), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "fambudget-report-" + period + ".docx"
