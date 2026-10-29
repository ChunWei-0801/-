"""Versioned public financial-education summaries, ranked by sparse BM25.

領域：數字

The corpus is authored for this project, with source links for checking. It is
not an unrestricted web search or a claim that original texts are public domain.
No personal ledger text enters the index and no instruction can trigger tools.
"""
from __future__ import annotations

from collections import Counter
from functools import lru_cache
import json
from math import log
from pathlib import Path

from app.services.ai_local import _tokens

CORPUS_PATH = Path(__file__).with_name("data") / "financial_knowledge.json"
# These are question scaffolding rather than financial subjects. A lone match
# such as「如何／計算」must not make an unrelated credit-card question look cited.
_QUERY_STOP = frozenset("如何 可以 需要 多少 安排 應該 我們 我的 目前 請問 等等 希望 提供 資訊 顯示 之後 所有 這個 那個 沒有 什麼 使用 計算 人的 規則".split())


def _content_tokens(text: str) -> list[str]:
    return [token for token in _tokens(text) if token not in _QUERY_STOP]


@lru_cache(maxsize=1)
def _index():
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    counts = [Counter(_content_tokens(" ".join([item["title"], item["text"], *item.get("keywords", [])]))) for item in corpus]
    subjects = [set(_content_tokens(" ".join(item.get("keywords", [])))) for item in corpus]
    frequency = Counter(token for document in counts for token in document)
    lengths = [sum(document.values()) for document in counts]
    average = sum(lengths) / len(lengths) if lengths else 1
    return corpus, counts, frequency, lengths, average, subjects


def search(query: str, limit: int = 4) -> dict:
    """Return only matched sources; unknown questions do not get invented hits."""
    query = query.strip()[:500]
    limit = max(1, min(8, limit))
    corpus, counts, frequency, lengths, average, subjects = _index()
    tokens = set(_content_tokens(query))
    scored = []
    for index, document in enumerate(counts):
        if not tokens.intersection(subjects[index]):
            continue
        score = 0.0
        for token in tokens:
            term_frequency = document.get(token, 0)
            if term_frequency:
                inverse_frequency = log(1 + (len(corpus) - frequency[token] + 0.5) / (frequency[token] + 0.5))
                score += inverse_frequency * term_frequency * 2.5 / (term_frequency + 1.5 * (0.25 + 0.75 * lengths[index] / average))
        if score > 0:
            scored.append((score, corpus[index]))
    scored.sort(key=lambda item: (-item[0], item[1]["id"]))
    return {
        "query": query, "method": "bm25", "corpusVersion": "financial-education-20261029-v1",
        "items": [{**{key: item.get(key) for key in ("id", "title", "text", "sourceLink", "sourceTitle", "reviewedAt", "sourcePublishedAt", "license")},
                   "score": round(score, 6)} for score, item in scored[:limit]],
        "totalMatches": len(scored), "truncated": len(scored) > limit,
    }
