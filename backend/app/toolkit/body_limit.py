"""Bound API request bytes while streaming, before multipart files are spooled."""

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class APIBodyLimit:
    def __init__(self, app, max_bytes=22 * 1024 * 1024):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"} or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    too_big = int(value) > self.max_bytes
                except ValueError:
                    return await JSONResponse({"detail": "無效的上傳長度"}, 400)(scope, receive, send)
                if too_big:
                    return await JSONResponse({"detail": "上傳資料太大，請縮小照片後重試"}, 413)(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(413, "上傳資料太大，請縮小照片後重試")
            return message

        return await self.app(scope, limited_receive, send)
