#!/usr/bin/env python3
"""Explicit production QA against the real Render site and Brevo email logs.

Default execution only prints a plan. --execute sends genuine verification
mail and retains clearly marked records in an explicitly selected QA account.
No app imports, test database, auth bypass, mock mail, or credential export.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import stat
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib import error, parse, request
from zoneinfo import ZoneInfo

SITE = "https://fambudget-recovery-20261017.onrender.com"
REPOSITORY = Path(__file__).resolve().parents[2]
TZ = ZoneInfo("Asia/Taipei")


class QAError(RuntimeError):
    """Only controlled, secret-free errors may be printed or saved."""


def require(condition, message):
    if not condition:
        raise QAError(message)


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward Bearer/API-key headers to another origin.


class HTTP:
    def __init__(self, origin, headers=None):
        require(origin in (SITE, "https://api.brevo.com"), "Unapproved HTTP origin")
        self.origin = origin.rstrip("/")
        self.headers = headers or {}
        # Inherits HTTP(S)_PROXY and CA trust; never attempts a direct bypass.
        self.opener = request.build_opener(NoRedirect(), request.HTTPSHandler(context=ssl.create_default_context()))

    def call(self, method, path, *, data=None, raw=None, content_type=None, headers=None, expected=(200,)):
        require(path.startswith("/") and not path.startswith("//"), "Request path must stay on its configured origin")
        all_headers = {"Accept": "application/json", **self.headers, **(headers or {})}
        if data is not None:
            raw = json.dumps(data, ensure_ascii=False).encode()
            content_type = "application/json"
        if content_type:
            all_headers["Content-Type"] = content_type
        req = request.Request(self.origin + path, data=raw, headers=all_headers, method=method)
        try:
            with self.opener.open(req, timeout=50) as response:
                status, body, received_headers = response.status, response.read(24 * 1024 * 1024), response.headers
        except error.HTTPError as exc:
            status, body, received_headers = exc.code, exc.read(24 * 1024 * 1024), exc.headers
        except Exception:
            raise QAError("Network/TLS request failed; inherited proxy and allowed-host policy must be checked") from None
        require(status in expected, "Unexpected HTTP status %s for %s request" % (status, method))
        return status, body, received_headers

    def json(self, method, path, **kwargs):
        status, body, headers = self.call(method, path, **kwargs)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError):
            raise QAError("Expected a JSON API response") from None
        return status, payload, headers


def multipart(image):
    boundary = "fambudget-qa-" + secrets.token_hex(12)
    raw = ("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"qa-receipt.png\"\r\n"
           "Content-Type: image/png\r\n\r\n" % boundary).encode() + image + ("\r\n--%s--\r\n" % boundary).encode()
    return raw, "multipart/form-data; boundary=" + boundary


def fixture_photo(tag, color="#176b5d"):
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (1200, 900), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1200, 160), fill=color)
    draw.text((50, 55), "FAMBUDGET QA RECEIPT - " + tag, fill="white")
    draw.text((60, 250), "Production test fixture. No real purchase. Actual amount TWD 73.25", fill="black")
    draw.text((60, 300), "Owner-only photograph, theme sync, and earned puzzle validation", fill=color)
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def decode_image(body, *, expected_size=None, max_edge=None):
    from PIL import Image

    with Image.open(io.BytesIO(body)) as image:
        image.load()
        require(image.format == "JPEG", "Stored photo was not normalized to JPEG")
        require(not image.getexif(), "Stored photo still contains EXIF metadata")
        if expected_size:
            require(image.size == expected_size, "Stored photo dimensions differ")
        if max_edge:
            require(max(image.size) <= max_edge, "Stored image exceeded its size limit")


def private_path(path, *, must_exist):
    """Require owner-only files in an existing private directory outside Git."""
    path = path.expanduser().absolute()
    require(not path.is_symlink(), "Private paths must not be symbolic links")
    path = path.resolve()
    require(path != REPOSITORY and REPOSITORY not in path.parents,
            "Private credentials and reports must be outside the repository")
    require(not any((parent / ".git").exists() for parent in path.parents),
            "Private credentials and reports must be outside every Git checkout")
    parent = path.parent.stat()
    require(stat.S_ISDIR(parent.st_mode) and stat.S_IMODE(parent.st_mode) == 0o700
            and parent.st_uid == os.getuid(), "Private parent directory must be owned by this user and mode 0700")
    if must_exist or path.exists():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.getuid() and info.st_nlink == 1,
                "Private file must be an owner-held regular file with mode 0600 and one link")
    return path


def private_json(path, value):
    path = private_path(path, must_exist=False)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".qa-", delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), 0o600)
            json.dump(value, handle, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_credentials(path, qa_email):
    path = private_path(path, must_exist=True)
    data = json.loads(path.read_text())
    require(data.get("email") == qa_email, "QA email must exactly match the explicitly selected dedicated account")
    require(data.get("qaOnly") is True and data.get("baseUrl") == SITE, "QA credential metadata must identify this production test scope")
    require(data.get("name", "").startswith("QA "), "Account must have a clear QA name")
    require(12 <= len(data.get("password", "").encode()) <= 72, "QA password length is invalid")
    require(isinstance(data.get("tag"), str) and 3 <= len(data["tag"]) <= 80
            and "QA" in data["tag"].upper() and not any(ord(char) < 32 for char in data["tag"]),
            "A short, clearly marked QA tag is required")
    return data


def parsed_date(value):
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result if result.tzinfo else result.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


class Run:
    def __init__(self, args):
        self.args = args
        self.api = HTTP(args.site)
        self.tokens = {}
        self.report = {"site": args.site, "startedAt": datetime.now(timezone.utc).isoformat(),
                       "status": "running", "steps": [], "artifacts": {},
                       "mailboxReceipt": "not observed by this API script",
                       "scope": "Dedicated authorized QA account only; no existing real-user data changed"}

    def mark(self, name, **safe_fields):
        self.report["steps"].append({"check": name, "at": datetime.now(timezone.utc).isoformat(), **safe_fields})
        private_json(self.args.report, self.report)
        print(json.dumps({"check": name, **safe_fields}, ensure_ascii=False), flush=True)

    def api_json(self, method, path, *, auth=True, **kwargs):
        headers = {"Authorization": "Bearer " + self.tokens["accessToken"]} if auth else {}
        return self.api.json(method, path, headers=headers, **kwargs)[1]

    def own_identity(self, credentials):
        user = self.api_json("GET", "/api/auth/me")["user"]
        require(user.get("email", "").casefold() == credentials["email"].casefold()
                and user.get("emailVerified") is True and user.get("name") == credentials["name"],
                "Session must identify the explicitly selected verified QA account")
        require(bool(user.get("id")), "QA account ID missing")
        if credentials.get("expectedUserId"):
            require(str(user["id"]) == str(credentials["expectedUserId"]), "QA session account ID changed")
        if credentials.get("expectedFamilyId"):
            require(str(user.get("familyId")) == str(credentials["expectedFamilyId"]), "QA session household ID changed")
        return user

    def image(self, path):
        status, body, headers = self.api.call("GET", path, headers={"Authorization": "Bearer " + self.tokens["accessToken"]})
        require(headers.get("Content-Type", "").startswith("image/jpeg"), "Private photo MIME mismatch")
        require("no-store" in headers.get("Cache-Control", ""), "Private image must prohibit caching")
        decode_image(body)
        require(self.api.call("GET", path, expected=(401,))[0] == 401, "Anonymous photo read was not rejected")
        return body

    def upload(self, method, path, image, expected=200):
        raw, content_type = multipart(image)
        return self.api_json(method, path, raw=raw, content_type=content_type, expected=(expected,))

    def mail_token(self, credentials, started):
        # Placeholder is used normally as a Brevo HTTP header on its allowed
        # domain only. It is never copied into Render config or any report.
        key = os.environ.get("BREVO_API_KEY")
        require(bool(key), "BREVO_API_KEY binding is needed to inspect the actual transactional mail")
        brevo = HTTP("https://api.brevo.com", {"api-key": key})
        deadline = time.monotonic() + self.args.mail_timeout
        subject = "驗證你的家庭記帳信箱"
        while time.monotonic() < deadline:
            query = parse.urlencode({"email": credentials["email"], "limit": 20, "sort": "desc"})
            _, listing, _ = brevo.json("GET", "/v3/smtp/emails?" + query)
            for mail in listing.get("transactionalEmails", []):
                if mail.get("email", "").lower() != credentials["email"].lower() or mail.get("subject") != subject:
                    continue
                if parsed_date(mail.get("date")) < started - timedelta(seconds=10):
                    continue
                _, content, _ = brevo.json("GET", "/v3/smtp/emails/" + parse.quote(str(mail["uuid"]), safe=""))
                body = html.unescape(content.get("body", ""))
                found = re.search(re.escape(self.args.site.rstrip("/")) + r"/#/verify-email/([A-Za-z0-9_-]{32,128})", body)
                if not found:
                    continue
                delivered = next((event for event in content.get("events", []) if event.get("name") == "delivered"), None)
                if delivered is None:
                    events_query = parse.urlencode({"messageId": mail["messageId"], "days": 1, "event": "delivered", "limit": 20})
                    _, events, _ = brevo.json("GET", "/v3/smtp/statistics/events?" + events_query)
                    delivered = next((event for event in events.get("events", [])
                                      if event.get("messageId") == mail["messageId"] and event.get("event") == "delivered"), None)
                if delivered:
                    self.mark("real verification email delivered; link origin matches production",
                              deliveryEvidence="Brevo delivered event", deliveredAt=delivered.get("time") or delivered.get("date"))
                    return found.group(1)
            time.sleep(5)
        raise QAError("Timed out waiting for a delivered production verification email and its exact-origin link")

    def execute(self):
        credentials = read_credentials(self.args.credentials, self.args.qa_email)
        require(self.args.site == SITE, "Only the coordinated production origin is allowed")
        require(bool(os.environ.get("BREVO_API_KEY")), "Brevo log credential binding missing; stopped before account creation")
        require(self.api.call("GET", "/readyz")[0] == 200, "Production readiness failed")
        capabilities = self.api_json("GET", "/capabilities", auth=False)
        require(capabilities.get("email_verification_required") is True, "Production email verification must be required")
        require(capabilities.get("email_delivery_mode") == "email", "Render mail service is not configured; stopped before creating QA account")
        for path in ("/", "/js/app.js", "/js/media.js", "/js/memories.js", "/js/login-background.js"):
            require(self.api.call("GET", path)[0] == 200, "Production asset missing")
        self.mark("production readiness, real mail mode, and public assets")

        status, registration, _ = self.api.json("POST", "/api/auth/register", data={k: credentials[k] for k in ("name", "email", "password")}, expected=(201, 409))
        require(status == 201, "Dedicated QA email already exists; use the preserved credential file and inspect prior QA state; no reset or existing-data changes attempted")
        require(registration.get("verificationRequired") is True and "accessToken" not in registration and "refreshToken" not in registration,
                "Unverified registration unexpectedly received a login credential")
        require(self.api.call("POST", "/api/auth/login", data={k: credentials[k] for k in ("email", "password")}, expected=(403,))[0] == 403,
                "Unverified QA account was allowed to log in")
        self.mark("new QA registration requires verification and rejects pre-verification login")

        requested_at = datetime.now(timezone.utc)
        delivery = self.api_json("POST", "/api/auth/email-verification/request", auth=False,
                                 data={"email": credentials["email"], "language": "zh-TW"})
        require(delivery.get("delivery") == "email" and "demoVerificationUrl" not in delivery, "Verification route returned a demonstration result")
        token = self.mail_token(credentials, requested_at)
        verified = self.api_json("POST", "/api/auth/email-verification/confirm", auth=False, data={"token": token})
        require(verified.get("emailVerified") is True and verified.get("email") == credentials["email"], "Real verification confirmation failed")
        self.api.call("POST", "/api/auth/email-verification/confirm", data={"token": token}, expected=(400,))
        token = None
        self.mark("actual emailed token confirms once and replay is rejected")

        self.tokens = self.api_json("POST", "/api/auth/login", auth=False, data={k: credentials[k] for k in ("email", "password")})
        registered_id = (registration.get("user") or {}).get("id")
        if registered_id:
            credentials["expectedUserId"] = registered_id
        user = self.own_identity(credentials)
        self.report["artifacts"]["userId"] = user["id"]
        credentials["expectedUserId"] = user["id"]
        private_json(self.args.credentials, credentials)
        self.api_json("PATCH", "/api/auth/me", data={"onboarded": True})
        family = self.api_json("POST", "/api/family", data={"name": credentials["tag"]}, expected=(201,))
        credentials["expectedFamilyId"] = family["family"]["id"]
        private_json(self.args.credentials, credentials)
        self.own_identity(credentials)
        self.report["artifacts"]["familyId"] = family["family"]["id"]
        group = self.api_json("POST", "/api/groups", data={"name": credentials["tag"], "note": "Production QA only; no real purchase data"}, expected=(201,))
        self.report["artifacts"]["groupId"] = group["id"]
        self.api_json("PUT", "/api/savings-goal", data={"goal": 5000})
        require(self.api_json("GET", "/api/auth/me")["user"]["savingsGoal"] == 5000, "Savings target did not persist")
        self.mark("verified QA household, own ledger, onboarding, and savings goal")

        photo = fixture_photo(credentials["tag"])
        data_url = "data:image/png;base64," + base64.b64encode(photo).decode()
        avatar = self.api_json("PUT", "/api/auth/me/avatar", data={"image": data_url})
        decode_image(base64.b64decode(avatar["avatarUrl"].split(",", 1)[1]), max_edge=256)
        for language in ("zh-TW", "zh-CN", "en", "ja", "ko", "es"):
            self.api_json("PATCH", "/api/auth/me", data={"language": language})
            require(self.api_json("GET", "/api/auth/me")["user"]["language"] == language, "Account language did not persist")
        for preset in ("dawn", "forest", "night"):
            self.api_json("PATCH", "/api/auth/me", data={"appearance": {"preset": preset}})
            require(self.api_json("GET", "/api/auth/me")["user"]["appearance"]["preset"] == preset, "Background preset did not persist")
        self.api_json("PATCH", "/api/auth/me", data={"theme": "paper", "language": "zh-TW", "appearance": {"preset": "custom", "fit": "contain", "x": 25, "y": 75}})
        uploaded = self.api_json("POST", "/api/auth/me/appearance-image", data={"dataUrl": data_url})
        background = self.image(uploaded["url"])
        decode_image(background, expected_size=(1200, 900))
        self.mark("avatar, six account languages, three backgrounds, and private custom image")

        old_refresh = self.tokens["refreshToken"]
        self.tokens = self.api_json("POST", "/api/auth/refresh", auth=False, data={"refreshToken": old_refresh})
        self.api.call("POST", "/api/auth/refresh", data={"refreshToken": old_refresh}, expected=(401,))
        del old_refresh
        fresh_user = self.own_identity(credentials)
        require(fresh_user["appearance"]["preset"] == "custom" and fresh_user["appearance"]["y"] == 75, "Appearance did not survive session renewal")
        require(self.image(fresh_user["appearanceImageUrl"]) == background, "Background photo changed across sessions")
        self.mark("refresh rotation, stale refresh rejection, and account presentation persistence")

        categories = self.api_json("GET", "/api/categories")["categories"]
        category = next(item["id"] for item in categories if item["kind"] == "expense" and not item.get("custom"))
        state = self.api_json("GET", "/api/memories")
        require(state["current"] is None and state["totalEarned"] == 0, "New QA account unexpectedly has pre-existing puzzle/ledger data")
        self.api_json("PATCH", "/api/memories/settings", data={"wallName": credentials["tag"] + " 成就牆", "period": "week", "timezone": "Asia/Taipei", "pieceCount": 9, "changesPerPeriod": 1})
        first = self.upload("POST", "/api/memories/puzzles", photo, expected=201)["current"]
        first_image = self.image(first["imageUrl"])
        self.upload("POST", "/api/memories/puzzles", photo, expected=409)
        records = []
        for number in range(9):
            transaction = self.api_json("POST", "/api/transactions", expected=(201,), data={
                "date": datetime.now(TZ).date().isoformat(), "amount": 73.25 + number,
                "kind": "expense", "cat": category, "groupId": group["id"],
                "merchant": "QA synthetic receipt", "note": credentials["tag"] + " fixture " + str(number + 1)})
            records.append(transaction)
            current = self.api_json("GET", "/api/memories")
            require(current["totalEarned"] == number + 1 and current["current"]["earnedPieces"] == number + 1,
                    "Each committed transaction must award exactly one puzzle piece")
        completed = current["current"]
        require(completed["completed"] and completed["earnedPieces"] == 9, "Ninth ledger write did not complete the puzzle")
        self.report["artifacts"]["transactionIds"] = [record["id"] for record in records]
        self.report["artifacts"]["completedPuzzleId"] = completed["id"]
        self.mark("nine real QA ledger writes earn nine pieces; unfinished replacement rejected")

        transaction_id = records[0]["id"]
        receipt = self.upload("POST", "/api/transactions/" + transaction_id + "/photos", photo, expected=201)
        receipt_bytes = self.image(receipt["url"])
        decode_image(receipt_bytes, expected_size=(1200, 900))
        listing = self.api_json("GET", "/api/transactions/" + transaction_id + "/photos")
        require(any(item["id"] == receipt["id"] for item in listing["photos"]), "Uploaded receipt missing from its transaction")
        updated = self.api_json("PATCH", "/api/transactions/" + transaction_id, data={"amount": 74.50})
        require(Decimal(str(updated["amount"])) == Decimal("74.50"), "Manual actual amount changed precision")
        require(self.api_json("GET", "/api/memories")["totalEarned"] == 9, "Editing a ledger entry minted another puzzle piece")
        self.report["artifacts"].update({"receiptPhotoId": receipt["id"], "receiptSha256": hashlib.sha256(receipt_bytes).hexdigest(),
                                         "completedPuzzlePhotoSha256": hashlib.sha256(first_image).hexdigest()})
        self.mark("private transaction receipt persists, manual actual amount is exact, edits do not mint pieces")

        self.upload("POST", "/api/memories/puzzles", photo, expected=409)
        self.api_json("PATCH", "/api/memories/settings", data={"period": "month"})
        self.upload("POST", "/api/memories/puzzles", photo, expected=409)
        self.api_json("PATCH", "/api/memories/settings", data={"changesPerPeriod": 2})
        second = self.upload("POST", "/api/memories/puzzles", fixture_photo(credentials["tag"], "#275d38"), expected=201)["current"]
        require(second["id"] != completed["id"] and second["earnedPieces"] == 0, "New completed-period puzzle did not start correctly")
        require(self.image(first["imageUrl"]) == first_image, "Completed puzzle image was overwritten")
        achievements = self.api_json("GET", "/api/memories/achievements?" + parse.urlencode({"year": completed["year"], "month": completed["month"]}))
        require(any(item["id"] == completed["id"] for item in achievements["achievements"]), "Year/month achievement query lost the completed puzzle")
        wall = self.upload("PUT", "/api/memories/wall-background", photo)
        wall_image = self.image(wall["settings"]["wallBackgroundUrl"])
        self.report["artifacts"]["wallPhotoSha256"] = hashlib.sha256(wall_image).hexdigest()
        self.mark("weekly/monthly quotas, completion snapshot, named wall, year/month search, private wall photo")

        quote = self.api_json("POST", "/api/exchange/convert", data={"amount": "2.50", "fromCurrency": "USD", "toCurrency": "TWD"})
        require(Decimal(str(quote["rate"])) > 0 and Decimal(str(quote["convertedAmount"])) > 0, "Actual exchange quote missing")
        self.mark("actual external exchange quote", provider=quote["provider"], sourceDate=quote["updatedAt"], stale=quote["stale"])

        self.tokens = self.api_json("POST", "/api/auth/login", auth=False, data={k: credentials[k] for k in ("email", "password")})
        self.own_identity(credentials)
        require(self.image(receipt["url"]) == receipt_bytes and self.image(wall["settings"]["wallBackgroundUrl"]) == wall_image,
                "Private photos did not survive a fresh login")
        self.api_json("PATCH", "/api/auth/me", data={"theme": "paper", "language": "zh-TW", "appearance": {"preset": "forest"}})
        old_access = self.tokens["accessToken"]
        self.api_json("POST", "/api/auth/logout", data={"refreshToken": self.tokens["refreshToken"]})
        self.api.call("GET", "/api/auth/me", headers={"Authorization": "Bearer " + old_access}, expected=(401,))
        self.tokens.clear()
        del old_access
        self.mark("fresh login retains photos; logout immediately revokes its access session")
        self.report["status"] = "passed"
        self.report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        self.report["limitations"] = ["Provider delivered event proves remote delivery; human inbox receipt is recorded separately.",
                                      "Cross-account ACL and camera UI/mobile browser need their own verified-session/browser checks.",
                                      "QA data is retained for private backup/restore validation; no real-user records were deleted.",
                                      "Remember-login browser storage selection is validated by browser tests, not this HTTP script."]
        private_json(self.args.report, self.report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Run coordinated real production QA; sends actual verification mail")
    parser.add_argument("--site", default=SITE)
    parser.add_argument("--qa-email", default=os.environ.get("FAMBUDGET_QA_EMAIL"), help="Explicitly authorized QA address; must match private JSON")
    parser.add_argument("--credentials", type=Path, help="Existing private 0600 QA JSON outside Git; required with --execute")
    parser.add_argument("--report", type=Path, help="Private JSON report outside Git; required with --execute")
    parser.add_argument("--mail-timeout", type=int, default=240)
    args = parser.parse_args()
    if args.site != SITE:
        parser.error("Only the exact coordinated production origin is allowed")
    if not args.execute:
        print("Prepared only. No HTTP calls or emails. --execute runs real QA against the exact coordinated Render origin.")
        print("Requires private 0600 QA credential JSON, ready BREVO_API_KEY, production mail mode, and approved site-host policy.")
        print("All tokens/passwords/mail bodies remain private; sanitized step report contains hashes and QA asset IDs only.")
        return 0
    if not args.credentials or not args.report or not args.qa_email:
        parser.error("--execute requires --credentials, --report, and --qa-email or FAMBUDGET_QA_EMAIL")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", args.qa_email) or args.qa_email.lower().endswith(".test"):
        parser.error("Select an actual authorized QA mailbox; example .test addresses cannot execute")
    if not 10 <= args.mail_timeout <= 900:
        parser.error("--mail-timeout must be between 10 and 900 seconds")
    run = None
    try:
        require(os.environ.get("PRODUCTION_QA_POLICY_READY") == "yes",
                "Start a new task and confirm the allowed-host policy before setting PRODUCTION_QA_POLICY_READY=yes")
        args.credentials = private_path(args.credentials, must_exist=True)
        args.report = private_path(args.report, must_exist=False)
        require(args.credentials != args.report, "Credentials and report paths must differ")
        read_credentials(args.credentials, args.qa_email)
        require(bool(os.environ.get("BREVO_API_KEY")), "Brevo log credential binding missing; no production request attempted")
        run = Run(args)
        run.execute()
        return 0
    except Exception as exc:
        # Never print exception repr/tracebacks/response payloads: third-party
        # exceptions can contain authentication headers or message bodies.
        message = str(exc) if isinstance(exc, QAError) else "Unexpected local validation failure (details withheld to protect credentials)"
        if run is not None:
            run.report.update(status="failed", failure=message, finishedAt=datetime.now(timezone.utc).isoformat())
            try:
                private_json(args.report, run.report)
            except Exception:
                pass  # Never disclose exception details from private storage.
        print(json.dumps({"status": "failed", "reason": message}, ensure_ascii=False), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
