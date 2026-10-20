"""Bounded read-only inputs and citation-bearing browser-local AI responses.

領域：數字
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ContextQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: str | None = Field(default=None, min_length=7, max_length=7, pattern=r"^[0-9]{4}-[0-9]{2}$")
    scope: Literal["me", "family"] = "me"
    limit: int = Field(default=12, ge=1, le=30)
    offset: int = Field(default=0, ge=0, le=10000)

    @field_validator("period")
    @classmethod
    def valid_month(cls, value: str | None) -> str | None:
        if value is not None and not (1900 <= int(value[:4]) <= 9998 and 1 <= int(value[5:]) <= 12):
            raise ValueError("月份須為 1900-01 至 9998-12 的 YYYY-MM")
        return value


class KnowledgeQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q: str = Field(min_length=1, max_length=500)
    language: Literal["zh-TW", "en"] = "zh-TW"
    limit: int = Field(default=4, ge=1, le=8)

    @field_validator("q")
    @classmethod
    def meaningful_query(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("請輸入查詢內容")
        return value


class Source(BaseModel):
    id: str
    title: str
    link: str


class PeriodSummary(BaseModel):
    period: str
    start: str
    end: str
    income: str
    expense: str
    net: str
    wardIncome: str
    transactionCount: int


class ScopeInfo(BaseModel):
    includedPeople: int
    definition: str
    wardIncomeExcluded: bool
    detailPeople: int
    summaryOnlyPeople: int


class Comparison(BaseModel):
    incomeDelta: str
    expenseDelta: str
    netDelta: str


class CategoryComparison(BaseModel):
    categoryId: str
    name: str
    currentExpense: str
    previousExpense: str
    delta: str


class CategoryPage(BaseModel):
    items: list[CategoryComparison]
    totalCount: int
    truncated: bool


class BudgetEvidence(BaseModel):
    id: str
    categoryId: str | None
    limit: str
    spent: str
    remaining: str
    sourceLink: str


class BudgetPage(BaseModel):
    items: list[BudgetEvidence]
    totalCount: int
    truncated: bool


class SavingsEvidence(BaseModel):
    goal: str
    actual: str
    shortfall: str
    goalIds: list[str]
    goalCount: int
    goalsTruncated: bool
    sourceLink: str


class CoachFact(BaseModel):
    id: str
    kind: str
    message: str
    evidenceIds: list[str]


class TransactionEvidence(BaseModel):
    id: str
    evidenceId: str
    date: str
    kind: str
    amount: str
    categoryId: str
    categoryName: str
    merchant: str
    note: str
    includedInIncome: bool
    textTruncated: bool
    sourceLink: str


class TransactionPage(BaseModel):
    items: list[TransactionEvidence]
    limit: int
    offset: int
    totalCount: int
    withheldCount: int
    returnedCount: int
    hasMore: bool
    truncated: bool


class DataPolicy(BaseModel):
    readOnly: Literal[True] = True
    totalsComplete: Literal[True] = True
    untrustedFields: list[str]
    statement: str


class ContextOut(BaseModel):
    version: Literal[1] = 1
    period: str
    previousPeriod: str
    scope: Literal["me", "family"]
    currency: Literal["TWD"] = "TWD"
    scopeInfo: ScopeInfo
    current: PeriodSummary
    previous: PeriodSummary
    comparison: Comparison
    categories: CategoryPage
    budgets: BudgetPage
    savings: SavingsEvidence
    coachFacts: list[CoachFact]
    transactions: TransactionPage
    dataPolicy: DataPolicy
    sources: list[Source]


class KnowledgeChunk(BaseModel):
    id: str
    title: str
    text: str
    sourceLink: str
    score: float


class KnowledgeOut(BaseModel):
    query: str
    language: Literal["zh-TW", "en"]
    method: Literal["bm25"] = "bm25"
    items: list[KnowledgeChunk]
    totalMatches: int
    truncated: bool
