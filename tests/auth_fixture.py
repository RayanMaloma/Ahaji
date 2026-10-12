"""Network-scoped Supabase Auth/RLS browser fixture; never contacts the live project."""

import base64
import json
import time
import uuid
from urllib.parse import parse_qs, urlparse


PROJECT = "gbhleqizxcmxmutgcjon"
USER_ID = "00000000-0000-4000-8000-000000000001"
ROOMS = ["anbar", "haram", "saleh"]
DASHBOARD_ROOMS = [
    {"id": "anbar", "name": "السجن", "thumbnail_ref": "images/prison.jpg", "background_ref": "source/prison/background.jpg", "default_duration_seconds": 3600, "display_order": 0, "is_active": True, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"},
    {"id": "haram", "name": "الهرم", "thumbnail_ref": "images/pyramid.png", "background_ref": "source/pyramid/background.jpg", "default_duration_seconds": 2700, "display_order": 1, "is_active": False, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"},
    {"id": "saleh", "name": "العم صالح", "thumbnail_ref": "images/unclesaleh.png", "background_ref": "source/unclesaleh/background.jpg", "default_duration_seconds": 3600, "display_order": 2, "is_active": True, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"},
]
DASHBOARD_HINTS = [
    {"id": "hint-1", "room_id": "anbar", "body": "Look behind the door", "display_order": 0},
    {"id": "hint-2", "room_id": "anbar", "body": "Read the symbols", "display_order": 1},
    {"id": "hint-3", "room_id": "haram", "body": "Follow the stars", "display_order": 0},
]
DASHBOARD_MEDIA = [
    {"id": "media-1", "room_id": "anbar", "kind": "gm_image", "label": "Door clue", "asset_ref": "source/prison/images/مكان فك الزنزانة.png", "display_order": 0},
    {"id": "media-2", "room_id": "anbar", "kind": "gm_sound", "label": "Sound cue", "asset_ref": "source/prison/sounds/صوت باب العنبر.mp3", "display_order": 0},
    {"id": "media-3", "room_id": "anbar", "kind": "hint_sound", "label": None, "asset_ref": "source/prison/hint-sound.mp3", "display_order": 0},
    {"id": "media-4", "room_id": "anbar", "kind": "lose_sound", "label": None, "asset_ref": "source/prison/loose-sound.mp3", "display_order": 0},
    {"id": "media-5", "room_id": "haram", "kind": "gm_image", "label": "Image 1", "asset_ref": "source/pyramid/imghint1.png", "display_order": 0},
    {"id": "media-6", "room_id": "haram", "kind": "gm_image", "label": "Image 2", "asset_ref": "source/pyramid/imghint2.png", "display_order": 1},
    {"id": "media-7", "room_id": "haram", "kind": "hint_sound", "label": None, "asset_ref": "source/pyramid/hint-sound.mp3", "display_order": 0},
    {"id": "media-8", "room_id": "saleh", "kind": "gm_image", "label": "Image 1", "asset_ref": "source/unclesaleh/imghint1.png", "display_order": 0},
    {"id": "media-9", "room_id": "saleh", "kind": "hint_sound", "label": None, "asset_ref": "source/unclesaleh/hint-sound.mp3", "display_order": 0},
    {"id": "media-10", "room_id": "saleh", "kind": "lose_video", "label": None, "asset_ref": "source/unclesaleh/loose-video.mp4", "display_order": 0},
]
DASHBOARD_STAFF = [
    {"user_id": USER_ID, "email": "staff@test.invalid", "email_confirmed": True, "role": "admin", "active": True, "account_type": "email", "login_name": None, "display_name": "ليلى", "avatar_ref": None, "created_at": "2026-01-01T00:00:00Z", "room_ids": []},
    {"user_id": "00000000-0000-4000-8000-000000000002", "email": "gm@test.invalid", "email_confirmed": True, "role": "game_master", "active": False, "account_type": "email", "login_name": None, "display_name": None, "avatar_ref": None, "created_at": "2026-01-01T00:00:00Z", "room_ids": ["anbar"]},
]


def session():
    def b64(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    exp = int(time.time()) + 3600
    token = f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': USER_ID, 'exp': exp, 'role': 'authenticated'})}.mock"
    user = {"id": USER_ID, "email": "staff@test.invalid", "email_confirmed_at": "2026-01-01T00:00:00Z", "role": "authenticated", "aud": "authenticated", "user_metadata": {"display_name": "ليلى"}}
    return {"access_token": token, "refresh_token": "local-fixture-only", "token_type": "bearer",
            "expires_in": 3600, "expires_at": exp, "user": user}


def install_auth_mock(context, role="admin", rooms=None, authenticated=True, dashboard=False, fail_dashboard=False, fail_dashboard_once=False, user_override=None, local_session=True, session_store=None):
    allowed = ROOMS if rooms is None else rooms
    failures_left = 1 if fail_dashboard_once else 0
    if authenticated:
        payload = json.dumps(session())
        context.add_init_script(
            ("window.ahajiUseLocalSession = true;" if local_session else "") +
            "if (location.hostname === '127.0.0.1' && !sessionStorage.getItem('ahaji-fixture-ready')) {"
            f"localStorage.setItem('sb-gbhleqizxcmxmutgcjon-auth-token', {json.dumps(payload)});"
            "sessionStorage.setItem('ahaji-fixture-ready', '1');}"
        )
    elif local_session:
        context.add_init_script("window.ahajiUseLocalSession = true;")

    def reply(route):
        nonlocal failures_left
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        query = parse_qs(parsed.query)
        headers = {"content-type": "application/json", "access-control-allow-origin": "*"}
        if path.endswith("/auth/v1/user"):
            route.fulfill(status=200, headers=headers, body=json.dumps(user_override if user_override is not None else session()["user"]))
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
            data = {"role": role, "active": True, "account_type": "email", "login_name": None} if role else None
            if "application/vnd.pgrst.object+json" in request.headers.get("accept", ""):
                route.fulfill(status=200 if data else 406, headers=headers, body=json.dumps(data if data else {}))
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps([data] if data else []))
        elif path.endswith("/rest/v1/staff_profiles"):
            data = {"user_id": USER_ID, "display_name": "ليلى", "avatar_ref": None}
            if "application/vnd.pgrst.object+json" in request.headers.get("accept", ""):
                route.fulfill(status=200, headers=headers, body=json.dumps(data))
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps([data]))
        elif path.endswith("/rest/v1/rooms"):
            wanted = query.get("id", [None])[0]
            data = DASHBOARD_ROOMS if dashboard else [room for room in DASHBOARD_ROOMS if room['id'] in allowed]
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
                          body=json.dumps({"message": "Unavailable"} if failed else DASHBOARD_HINTS))
        elif path.endswith("/rest/v1/room_media"):
            route.fulfill(status=200, headers=headers, body=json.dumps(DASHBOARD_MEDIA))
        elif path.endswith("/rest/v1/game_sessions"):
            route.fulfill(status=200, headers=headers, body="[]")
        elif path.endswith("/rest/v1/session_events"):
            route.fulfill(status=200, headers=headers, body="[]")
        elif path.endswith("/rest/v1/rpc/admin_settle_sessions"):
            route.fulfill(status=200, headers=headers, body="0")
        elif path.endswith("/rest/v1/rpc/admin_staff_directory"):
            route.fulfill(status=200, headers=headers, body=json.dumps(DASHBOARD_STAFF if dashboard and role == "admin" else []))
        elif session_store is not None and path.endswith("/rest/v1/rpc/create_game_session"):
            room_id = (request.post_data_json or {}).get("p_room_id")
            room = next((r for r in DASHBOARD_ROOMS if r["id"] == room_id), None)
            sid = str(uuid.uuid4())
            config = {"id": room_id, "name": room["name"], "thumbnail": room["thumbnail_ref"],
                      "backgroundImage": room["background_ref"], "defaultDuration": room["default_duration_seconds"],
                      "media": {"hintSound": None, "loseSound": None, "loseVideo": None,
                                "gmImages": [], "gmSounds": [], "gmVideos": []}, "hints": {"items": []}}
            state = {"roomId": room_id, "sessionId": sid, "roomName": room["name"],
                     "image": room["background_ref"], "status": "idle", "remainingSeconds": 3600,
                     "endsAt": None, "hintText": "", "activeImageSrc": None, "activeVideoSrc": None,
                     "activeImageScale": 100, "viewMode": "normal", "roomConfig": config,
                     "lastUpdatedAt": int(time.time()*1000)}
            session_store[sid] = {"state": state, "revision": 1, "token": "a"*48}
            route.fulfill(status=200, headers=headers, body=json.dumps({"sessionId": sid, "castToken": "a"*48,
                          "state": state, "serverNow": int(time.time()*1000), "revision": 1}))
        elif session_store is not None and path.endswith("/rest/v1/rpc/get_game_session"):
            sid = (request.post_data_json or {}).get("p_session_id")
            item = session_store.get(sid)
            route.fulfill(status=200 if item else 403, headers=headers,
                          body=json.dumps({"state": item["state"], "revision": item["revision"],
                                           "serverNow": int(time.time()*1000)} if item else {"message": "denied"}))
        elif session_store is not None and path.endswith("/rest/v1/rpc/game_session_command"):
            body = request.post_data_json or {}
            item = session_store.get(body.get("p_session_id"))
            if not item:
                route.fulfill(status=403, headers=headers, body='{"message":"denied"}')
            else:
                state = item["state"].copy()
                command = body.get("p_command")
                value = body.get("p_value") or {}
                if command == "start":
                    state.update(status="running", endsAt=int(time.time()*1000)+state["remainingSeconds"]*1000)
                elif command == "pause": state.update(status="paused", endsAt=None)
                elif command == "resume": state.update(status="running", endsAt=int(time.time()*1000)+state["remainingSeconds"]*1000)
                elif command == "hint": state["hintText"] = value.get("text", "")
                elif command == "win": state.update(status="ended", viewMode="win", endsAt=None)
                elif command == "image": state["activeImageSrc"] = None
                item["revision"] += 1
                state["lastUpdatedAt"] = int(time.time()*1000)
                item["state"] = state
                route.fulfill(status=200, headers=headers, body=json.dumps({"state": state,
                              "revision": item["revision"], "serverNow": int(time.time()*1000)}))
        elif session_store is not None and path.endswith("/rest/v1/rpc/cast_session_state"):
            body = request.post_data_json or {}
            item = session_store.get(body.get("p_session_id"))
            if not item or body.get("p_token") != item["token"] or body.get("p_room_id") != item["state"]["roomId"]:
                route.fulfill(status=403, headers=headers, body='{"message":"denied"}')
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps({"state": item["state"],
                              "revision": item["revision"], "serverNow": int(time.time()*1000)}))
        else:
            route.fulfill(status=404, headers=headers, body="{}")

    context.route(f"https://{PROJECT}.supabase.co/**", reply)
