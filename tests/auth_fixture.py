"""Network-scoped Supabase Auth/RLS browser fixture; never contacts the live project."""

import base64
import json
import time
from urllib.parse import parse_qs, urlparse


PROJECT = "gbhleqizxcmxmutgcjon"
USER_ID = "00000000-0000-4000-8000-000000000001"
ROOMS = ["anbar", "haram", "saleh"]
DASHBOARD_ROOMS = [
    {"id": "anbar", "name": "Prison", "thumbnail_ref": "images/prison.jpg", "background_ref": "source/prison/background.jpg", "default_duration_seconds": 3600, "display_order": 0, "is_active": True, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"},
    {"id": "haram", "name": "Pyramid", "thumbnail_ref": "images/pyramid.png", "background_ref": "source/pyramid/background.jpg", "default_duration_seconds": 2700, "display_order": 1, "is_active": False, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"},
]
DASHBOARD_HINTS = [
    {"id": "hint-1", "room_id": "anbar", "body": "Look behind the door", "display_order": 0},
    {"id": "hint-2", "room_id": "anbar", "body": "Read the symbols", "display_order": 1},
    {"id": "hint-3", "room_id": "haram", "body": "Follow the stars", "display_order": 0},
]
DASHBOARD_MEDIA = [
    {"id": "media-1", "room_id": "anbar", "kind": "gm_image", "label": "Door clue", "asset_ref": "source/prison/images/مكان فك الزنزانة.png", "display_order": 0},
    {"id": "media-2", "room_id": "haram", "kind": "hint_sound", "label": None, "asset_ref": "source/pyramid/hint-sound.mp3", "display_order": 0},
]
DASHBOARD_STAFF = [
    {"user_id": USER_ID, "email": "staff@test.invalid", "email_confirmed": True, "role": "admin", "active": True, "created_at": "2026-01-01T00:00:00Z", "room_ids": []},
    {"user_id": "00000000-0000-4000-8000-000000000002", "email": "gm@test.invalid", "email_confirmed": True, "role": "game_master", "active": False, "created_at": "2026-01-01T00:00:00Z", "room_ids": ["anbar"]},
]


def session():
    def b64(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    exp = int(time.time()) + 3600
    token = f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': USER_ID, 'exp': exp, 'role': 'authenticated'})}.mock"
    user = {"id": USER_ID, "email": "staff@test.invalid", "email_confirmed_at": "2026-01-01T00:00:00Z", "role": "authenticated", "aud": "authenticated"}
    return {"access_token": token, "refresh_token": "local-fixture-only", "token_type": "bearer",
            "expires_in": 3600, "expires_at": exp, "user": user}


def install_auth_mock(context, role="admin", rooms=None, authenticated=True, dashboard=False, fail_dashboard=False, fail_dashboard_once=False):
    allowed = ROOMS if rooms is None else rooms
    failures_left = 1 if fail_dashboard_once else 0
    if authenticated:
        payload = json.dumps(session())
        context.add_init_script(
            "if (location.hostname === '127.0.0.1' && !sessionStorage.getItem('ahaji-fixture-ready')) {"
            f"localStorage.setItem('sb-gbhleqizxcmxmutgcjon-auth-token', {json.dumps(payload)});"
            "sessionStorage.setItem('ahaji-fixture-ready', '1');}"
        )

    def reply(route):
        nonlocal failures_left
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
            data = DASHBOARD_ROOMS if dashboard else [{"id": room, "name": room.title()} for room in allowed]
            data = [room for room in data if not wanted or wanted == f"eq.{room['id']}"]
            if "application/vnd.pgrst.object+json" in request.headers.get("accept", ""):
                route.fulfill(status=200 if data else 406, headers=headers, body=json.dumps(data[0] if data else {}))
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps(data))
        elif path.endswith("/rest/v1/room_hints"):
            failed = fail_dashboard or failures_left > 0
            if failures_left > 0:
                failures_left -= 1
            route.fulfill(status=400 if failed else 200, headers=headers,
                          body=json.dumps({"message": "Unavailable"} if failed else DASHBOARD_HINTS if dashboard else []))
        elif path.endswith("/rest/v1/room_media"):
            route.fulfill(status=200, headers=headers, body=json.dumps(DASHBOARD_MEDIA if dashboard else []))
        elif path.endswith("/rest/v1/rpc/admin_staff_directory"):
            route.fulfill(status=200, headers=headers, body=json.dumps(DASHBOARD_STAFF if dashboard and role == "admin" else []))
        else:
            route.fulfill(status=404, headers=headers, body="{}")

    context.route(f"https://{PROJECT}.supabase.co/**", reply)
