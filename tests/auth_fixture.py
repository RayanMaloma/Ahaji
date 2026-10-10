"""Network-scoped Supabase Auth/RLS browser fixture; never contacts the live project."""

import base64
import json
import time
from urllib.parse import parse_qs, urlparse


PROJECT = "gbhleqizxcmxmutgcjon"
USER_ID = "00000000-0000-4000-8000-000000000001"
ROOMS = ["anbar", "haram", "saleh"]


def session():
    def b64(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    exp = int(time.time()) + 3600
    token = f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': USER_ID, 'exp': exp, 'role': 'authenticated'})}.mock"
    user = {"id": USER_ID, "email": "staff@test.invalid", "role": "authenticated", "aud": "authenticated"}
    return {"access_token": token, "refresh_token": "local-fixture-only", "token_type": "bearer",
            "expires_in": 3600, "expires_at": exp, "user": user}


def install_auth_mock(context, role="admin", rooms=None, authenticated=True):
    allowed = ROOMS if rooms is None else rooms
    if authenticated:
        payload = json.dumps(session())
        context.add_init_script(
            "if (location.hostname === '127.0.0.1') "
            f"localStorage.setItem('sb-gbhleqizxcmxmutgcjon-auth-token', {json.dumps(payload)});"
        )

    def reply(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        query = parse_qs(parsed.query)
        headers = {"content-type": "application/json", "access-control-allow-origin": "*"}
        if path.endswith("/auth/v1/user"):
            route.fulfill(status=200, headers=headers, body=json.dumps(session()["user"]))
        elif path.endswith("/auth/v1/logout"):
            route.fulfill(status=204, headers=headers, body="")
        elif path.endswith("/auth/v1/token"):
            body = request.post_data_json or {}
            if body.get("email", "").endswith("@test.invalid") and not body["email"].startswith("wrong"):
                route.fulfill(status=200, headers=headers, body=json.dumps(session()))
            else:
                route.fulfill(status=400, headers=headers, body=json.dumps({"msg": "Invalid login credentials", "error_code": "invalid_credentials"}))
        elif path.endswith("/auth/v1/recover"):
            route.fulfill(status=200, headers=headers, body="{}")
        elif path.endswith("/rest/v1/staff_accounts"):
            data = {"role": role, "active": True} if role else None
            if "application/vnd.pgrst.object+json" in request.headers.get("accept", ""):
                route.fulfill(status=200 if data else 406, headers=headers, body=json.dumps(data if data else {}))
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps([data] if data else []))
        elif path.endswith("/rest/v1/rooms"):
            wanted = query.get("id", [None])[0]
            selected = [room for room in allowed if not wanted or wanted == f"eq.{room}"]
            data = [{"id": room, "name": room.title()} for room in selected]
            if "application/vnd.pgrst.object+json" in request.headers.get("accept", ""):
                route.fulfill(status=200 if data else 406, headers=headers, body=json.dumps(data[0] if data else {}))
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps(data))
        else:
            route.fulfill(status=404, headers=headers, body="{}")

    context.route(f"https://{PROJECT}.supabase.co/**", reply)
