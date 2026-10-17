"""Both declared and chunked excessive uploads stop before endpoint processing."""

import asyncio
import json
from fastapi import FastAPI, Request
import httpx
from app.toolkit.body_limit import APIBodyLimit


def run(coro):
    return asyncio.run(coro)


def test_declared_body_rejected_without_endpoint_read():
    calls = []
    app = FastAPI()
    app.add_middleware(APIBodyLimit, max_bytes=8)
    @app.post("/api/photo")
    async def photo(request: Request):
        calls.append(True)
        return {"bytes": len(await request.body())}
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/photo", content=b"a"*9)
            assert response.status_code == 413 and calls == []
            small = await client.post("/api/photo", content=b"ok")
            assert small.json() == {"bytes": 2}
    run(exercise())


def test_chunked_payload_cannot_bypass_limit():
    app = FastAPI()
    app.add_middleware(APIBodyLimit, max_bytes=8)
    @app.post("/api/photo")
    async def photo(request: Request):
        return {"bytes": len(await request.body())}
    async def chunks():
        yield b"aaaaa"
        yield b"bbbbb"
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/photo", content=chunks())
            assert response.status_code == 413
    run(exercise())
