"""Browser PKCE login and refresh with a private, explicitly selected credential file."""

import base64
import hashlib
import http.server
import json
import os
import secrets
import stat
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from . import _NoRedirect


def _origin(value):
    u = urllib.parse.urlsplit(value)
    if (
        u.username
        or u.password
        or u.query
        or u.fragment
        or u.path not in ("", "/")
        or not (
            u.scheme == "https"
            or u.scheme == "http"
            and u.hostname in ("localhost", "127.0.0.1", "::1")
        )
    ):
        raise ValueError("Invalid OAuth origin")
    return value.rstrip("/")


def _endpoint(url, base):
    u = urllib.parse.urlsplit(url)
    if u.scheme + "://" + u.netloc != base or u.username or u.password or u.fragment:
        raise ValueError("OAuth endpoint belongs to another server")
    return url


def _json(url, data=None, form=False):
    body = (
        None
        if data is None
        else (
            urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        )
    )
    headers = (
        {}
        if body is None
        else {
            "Content-Type": (
                "application/x-www-form-urlencoded" if form else "application/json"
            )
        }
    )
    with urllib.request.build_opener(_NoRedirect).open(
        urllib.request.Request(url, data=body, headers=headers), timeout=30
    ) as r:
        raw = r.read(131073)
        if len(raw) > 131072:
            raise ValueError("OAuth response too large")
        return json.loads(raw)


class FileCredentialStore:
    def __init__(self, path):
        self.path = Path(path)

    def _check(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        s = self.path.parent.lstat()
        if (
            not stat.S_ISDIR(s.st_mode)
            or s.st_mode & 0o077
            or hasattr(os, "getuid")
            and s.st_uid != os.getuid()
        ):
            raise ValueError(
                "OAuth credential directory must be private and owned by you"
            )

    def load(self):
        self._check()
        try:
            fd = os.open(self.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except FileNotFoundError:
            return None
        with os.fdopen(fd) as f:
            s = os.fstat(f.fileno())
            if (
                not stat.S_ISREG(s.st_mode)
                or s.st_mode & 0o077
                or hasattr(os, "getuid")
                and s.st_uid != os.getuid()
            ):
                raise ValueError("Unsafe credential file permissions")
            return json.load(f)

    def save(self, value):
        self._check()
        temporary = str(self.path) + "." + secrets.token_hex(12)
        try:
            with os.fdopen(
                os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w"
            ) as f:
                json.dump(value, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def clear(self):
        self._check()
        self.path.unlink(missing_ok=True)


class OAuthSession:
    def __init__(self, value, store=None):
        _endpoint(value["token_endpoint"], _origin(value["base_url"]))
        self.value, self.store, self.lock = value, store, threading.RLock()

    @classmethod
    def load(cls, store, base_url="https://agfs.dev"):
        value = store.load()
        if value is None:
            return None
        if value["base_url"] != _origin(base_url):
            raise ValueError("Credentials belong to another server")
        return cls(value, store)

    def _update(self, token):
        if (
            not isinstance(token.get("access_token"), str)
            or token.get("token_type", "").lower() != "bearer"
            or not isinstance(token.get("expires_in"), (int, float))
            or token["expires_in"] <= 0
        ):
            raise ValueError("Invalid OAuth token response")
        self.value.update(
            access_token=token["access_token"],
            refresh_token=token.get("refresh_token", self.value.get("refresh_token")),
            expires_at=time.time() + token["expires_in"],
        )
        if self.store:
            self.store.save(self.value)

    def token(self):
        with self.lock:
            if self.value["expires_at"] <= time.time() + 60:
                if not self.value.get("refresh_token"):
                    raise ValueError("Sign in again to AGFS")
                self._update(
                    _json(
                        self.value["token_endpoint"],
                        {
                            "grant_type": "refresh_token",
                            "client_id": self.value["client_id"],
                            "refresh_token": self.value["refresh_token"],
                            "resource": self.value["base_url"] + "/mcp",
                        },
                        True,
                    )
                )
            return self.value["access_token"]

    @classmethod
    def login(
        cls,
        on_authorization_url,
        *,
        base_url="https://agfs.dev",
        store=None,
        scopes=None,
        cancel=None,
    ):
        base = _origin(base_url)
        metadata = _json(base + "/.well-known/oauth-authorization-server/api/auth")
        if metadata["issuer"] != base + "/api/auth":
            raise ValueError("Unexpected OAuth issuer")
        authorization = _endpoint(metadata["authorization_endpoint"], base)
        token_endpoint = _endpoint(metadata["token_endpoint"], base)
        registration = _endpoint(metadata["registration_endpoint"], base)
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(32)
        result = {}

        class Callback(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                u = urllib.parse.urlsplit(self.path)
                q = urllib.parse.parse_qs(u.query)
                if u.path != "/callback" or q.get("state") != [state]:
                    self.send_error(400)
                    return
                if "iss" in q and q["iss"] != [metadata["issuer"]]:
                    self.send_error(400)
                    return
                result["code"] = q.get("code", [None])[0]
                self.send_response(200 if result["code"] else 400)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b"Authorization finished. You can close this tab.")

        with http.server.HTTPServer(("127.0.0.1", 0), Callback) as server:
            server.timeout = 1
            redirect = f"http://127.0.0.1:{server.server_port}/callback"
            scope = " ".join(
                scopes or ["openid", "offline_access", "agfs:read", "agfs:write"]
            )
            client = _json(
                registration,
                {
                    "client_name": "AGFS Python SDK",
                    "application_type": "native",
                    "redirect_uris": [redirect],
                    "token_endpoint_auth_method": "none",
                    "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"],
                    "scope": scope,
                },
            )
            challenge = (
                base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
                .decode()
                .rstrip("=")
            )
            on_authorization_url(
                authorization
                + "?"
                + urllib.parse.urlencode(
                    {
                        "client_id": client["client_id"],
                        "response_type": "code",
                        "redirect_uri": redirect,
                        "state": state,
                        "code_challenge": challenge,
                        "code_challenge_method": "S256",
                        "resource": base + "/mcp",
                        "scope": scope,
                    }
                )
            )
            deadline = time.monotonic() + 300
            while "code" not in result:
                if time.monotonic() > deadline or cancel and cancel.is_set():
                    raise TimeoutError("OAuth login cancelled or timed out")
                server.handle_request()
            if not result["code"]:
                raise ValueError("Authorization declined")
            token = _json(
                token_endpoint,
                {
                    "grant_type": "authorization_code",
                    "client_id": client["client_id"],
                    "code": result["code"],
                    "redirect_uri": redirect,
                    "code_verifier": verifier,
                    "resource": base + "/mcp",
                },
                True,
            )
            session = cls(
                {
                    "base_url": base,
                    "client_id": client["client_id"],
                    "token_endpoint": token_endpoint,
                },
                store,
            )
            session._update(token)
            return session
