"""Room-wide draft behavior with a stateful, mocked Supabase HTTP boundary."""

import copy
import functools
import http.server
import json
import pathlib
import re
import threading
import unittest
import uuid
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright
from auth_fixture import DASHBOARD_ROOMS, DASHBOARD_HINTS, DASHBOARD_MEDIA, install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = "https://gbhleqizxcmxmutgcjon.supabase.co"
HEADERS = {"content-type": "application/json", "access-control-allow-origin": "*"}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class Store:
    def __init__(self, context):
        self.rooms = copy.deepcopy(DASHBOARD_ROOMS)
        self.hints = copy.deepcopy(DASHBOARD_HINTS)
        self.media = copy.deepcopy(DASHBOARD_MEDIA)
        self.calls = []
        self.reject = False
        self.conflict = False
        self.uploads = []
        self.cleanup = []
        context.route(HOST + "/rest/v1/rooms**", self.room_route)
        context.route(HOST + "/rest/v1/room_hints**", self.hint_route)
        context.route(HOST + "/rest/v1/room_media**", self.media_route)
        context.route(HOST + "/rest/v1/rpc/admin_save_room_draft", self.save_route)
        context.route(HOST + "/storage/v1/object/room-assets/**", self.storage_route)

    def room_route(self, route):
        req = route.request
        wanted = parse_qs(urlparse(req.url).query).get("id", [None])[0]
        if req.method == "POST":
            row = dict(req.post_data_json)
            if any(r["id"] == row["id"] for r in self.rooms):
                route.fulfill(status=409, headers=HEADERS,
                              body='{"code":"23505","message":"duplicate key"}')
                return
            row.update(display_order=len(self.rooms), content_revision=0,
                       created_at="2026-10-14T00:00:00Z", updated_at="2026-10-14T00:00:00Z")
            self.rooms.append(row)
            route.fulfill(status=201, headers=HEADERS, body=json.dumps(row))
            return
        if req.method == "PATCH":
            row = next(r for r in self.rooms if wanted == "eq." + r["id"])
            row.update(req.post_data_json)
            row["content_revision"] = row.get("content_revision", 0) + 1
            route.fulfill(status=200, headers=HEADERS, body=json.dumps(row))
            return
        if req.method == "DELETE":
            self.rooms[:] = [r for r in self.rooms if wanted != "eq." + r["id"]]
            route.fulfill(status=204, headers=HEADERS, body="")
            return
        rows = [r for r in self.rooms if (not wanted or wanted == "eq." + r["id"])
                and ("is_active=eq.true" not in req.url or r["is_active"])]
        single = "application/vnd.pgrst.object+json" in req.headers.get("accept", "")
        route.fulfill(status=200 if rows or not single else 406, headers=HEADERS,
                      body=json.dumps(rows[0] if single and rows else rows))

    def hint_route(self, route):
        route.fulfill(status=200, headers=HEADERS, body=json.dumps(self.hints))

    def media_route(self, route):
        route.fulfill(status=200, headers=HEADERS, body=json.dumps(self.media))

    def storage_route(self, route):
        if route.request.method == "POST":
            self.uploads.append(route.request.url)
            route.fulfill(status=200, headers=HEADERS, body='{"Key":"uploaded"}')
        elif route.request.method == "DELETE":
            self.cleanup.append(route.request.url)
            route.fulfill(status=200, headers=HEADERS, body="[]")
        else:
            route.fulfill(status=200, headers={"content-type": "application/octet-stream"}, body="")

    def save_route(self, route):
        data = route.request.post_data_json
        self.calls.append(copy.deepcopy(data))
        row = next(r for r in self.rooms if r["id"] == data["p_room_id"])
        if self.reject:
            route.fulfill(status=500, headers=HEADERS, body='{"message":"Save failed"}')
            return
        if self.conflict or data["p_expected_revision"] != row.get("content_revision", 0):
            route.fulfill(status=409, headers=HEADERS,
                          body='{"code":"40001","message":"Room changed"}')
            return
        details = data["p_room"]
        row.update(name=details["name"], description=details["description"],
                   default_duration_seconds=details["durationSeconds"],
                   is_active=details["active"], thumbnail_ref=details["imageRef"],
                   background_ref=details["imageRef"],
                   presentation_settings=details["presentation"])
        if data["p_hints"] is not None:
            self.hints[:] = [h for h in self.hints if h["room_id"] != row["id"]]
            self.hints.extend({"id": h["id"] or str(uuid.uuid4()), "room_id": row["id"],
                               "body": h["text"], "display_order": n}
                              for n, h in enumerate(data["p_hints"]))
        if data["p_media"] is not None:
            self.media[:] = [m for m in self.media if m["room_id"] != row["id"]]
            self.media.extend({"id": m["id"] or str(uuid.uuid4()), "room_id": row["id"],
                               "kind": m["kind"], "label": m["label"],
                               "asset_ref": m["assetRef"], "display_order": n}
                              for n, m in enumerate(data["p_media"]))
        row["content_revision"] = row.get("content_revision", 0) + 1
        route.fulfill(status=200, headers=HEADERS,
                      body=json.dumps({"revision": row["content_revision"]}))


class RoomManagementBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setup_page(self, **kwargs):
        context = self.browser.new_context(**kwargs)
        self.addCleanup(context.close)
        install_auth_mock(context, dashboard=True)
        store = Store(context)
        page = context.new_page()
        return context, store, page

    def test_shared_draft_media_sections_and_gm_propagation(self):
        context, store, page = self.setup_page()
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=settings")
        page.get_by_label("حجم المؤقت").fill("1.2")
        page.get_by_label("لون المؤقت").fill("#ffff00")
        frame = page.frame_locator(".cast-preview-frame")
        expect(frame.locator("[data-cast-stage]")).to_have_attribute("style", re.compile("--cast-timer-scale: 1.2"))
        page.locator(".room-settings-form input[type=file]").set_input_files(
            str(ROOT / "images" / "prison.jpg"))
        expect(frame.locator("[data-cast-bg]")).to_have_attribute("src", re.compile("^blob:"))
        page.get_by_role("link", name="المقاطع").click()
        expect(page.get_by_role("heading", name="مكتبة مقاطع مدير اللعبة")).to_be_visible()
        expect(page.get_by_role("heading", name="مقاطع أحداث اللعبة")).to_be_visible()
        expect(page.get_by_text("اختياري · غير مُعد")).to_be_visible()
        page.get_by_role("button", name="إضافة مقطع الخسارة").click()
        page.locator(".admin-dialog input[type=file]").set_input_files({
            "name": "loss.mp4", "mimeType": "video/mp4", "buffer": b"video-test"})
        page.get_by_role("button", name="إضافة إلى المسودة").click()
        expect(page.get_by_text("مُعد", exact=True)).to_be_visible()
        page.get_by_role("link", name="الأصوات").click()
        expect(page.get_by_role("heading", name="مكتبة أصوات مدير اللعبة")).to_be_visible()
        expect(page.get_by_role("heading", name="أصوات أحداث اللعبة")).to_be_visible()
        page.get_by_role("button", name="إضافة صوت").first.click()
        page.get_by_role("textbox", name="اسم الملف").fill("جرس الاختبار")
        page.locator(".admin-dialog input[type=file]").set_input_files({
            "name": "bell.mp3", "mimeType": "audio/mpeg", "buffer": b"audio-test"})
        page.get_by_role("button", name="إضافة إلى المسودة").click()
        expect(page.locator(".room-media-card").filter(has_text="جرس الاختبار")).to_be_visible()
        page.get_by_role("link", name="التلميحات").click()
        page.get_by_role("button", name=re.compile("إضافة تلميح")).click()
        page.locator(".admin-dialog textarea").fill("تلميح جديد")
        page.get_by_role("button", name="إضافة إلى المسودة").click()
        expect(page.get_by_text("تلميح جديد")).to_be_visible()
        last = page.locator(".workspace-row").last.locator("[data-drag-handle]")
        last.drag_to(page.locator(".workspace-row").first.locator("[data-drag-handle]"))
        expect(page.locator(".workspace-row").first).to_contain_text("تلميح جديد")
        self.assertEqual(store.calls, [])
        page.get_by_role("link", name="الإعدادات العامة").click()
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1.2")
        expect(page.get_by_label("لون المؤقت")).to_have_value("#ffff00")
        expect(frame.locator("[data-cast-stage]")).to_have_attribute("style", re.compile("--cast-timer-scale: 1.2"))
        expect(frame.locator("[data-cast-bg]")).to_have_attribute("src", re.compile("^blob:"))
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        expect(page.get_by_text("حُفظت جميع التغييرات.")).to_be_visible()
        self.assertEqual(len(store.calls), 1)
        self.assertEqual(store.rooms[0]["presentation_settings"]["timerScale"], 1.2)
        self.assertEqual(store.rooms[0]["thumbnail_ref"], store.rooms[0]["background_ref"])
        self.assertTrue(store.rooms[0]["background_ref"].startswith("storage://room-assets/"))
        self.assertEqual(next(h for h in store.hints if h["room_id"] == "anbar")["body"], "تلميح جديد")
        self.assertEqual(len([m for m in store.media if m["room_id"] == "anbar" and m["kind"] == "lose_video"]), 1)
        page.reload()
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1.2")
        gm = context.new_page()
        gm.goto(self.base + "/index.html")
        gm.locator(".room-card[data-room='anbar']").click()
        gm.locator("#btn-show-hints").click()
        expect(gm.locator("#saved-hints-list li").first).to_contain_text("تلميح جديد")

    def test_navigation_save_discard_stay_failure_and_conflict(self):
        _, store, page = self.setup_page()
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=settings")
        page.get_by_label("حجم المؤقت").fill("1.25")
        self.assertTrue(page.evaluate("""() => {
            const event = new Event('beforeunload', {cancelable:true});
            window.dispatchEvent(event); return event.defaultPrevented;
        }"""))
        page.get_by_role("link", name="جميع الغرف").click()
        dialog = page.get_by_role("dialog", name="تغييرات غير محفوظة")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="البقاء في الصفحة").click()
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1.25")
        page.get_by_role("link", name="فريق العمل").click()
        dialog.get_by_role("button", name="تجاهل التغييرات").click()
        expect(page).to_have_url(re.compile("view=staff"))
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=settings")
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1")
        page.get_by_label("حجم المؤقت").fill("1.3")
        store.reject = True
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        expect(page.locator(".room-savebar .room-draft-status.error")).to_be_visible()
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1.3")
        self.assertEqual(store.rooms[0].get("content_revision", 0), 0)
        store.reject = False
        store.conflict = True
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        expect(page.get_by_text(re.compile("عدّل مدير آخر"))).to_be_visible()
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1.3")
        store.conflict = False
        page.get_by_role("link", name="جميع الغرف").click()
        dialog.get_by_role("button", name="حفظ التغييرات والمغادرة").click()
        expect(page).to_have_url(re.compile("view=rooms"))
        self.assertEqual(store.rooms[0]["presentation_settings"]["timerScale"], 1.3)
        self.assertEqual(len(store.calls), 3)
        page.locator(".room-tile").first.click()
        page.get_by_label("حجم المؤقت").fill("1.1")
        page.evaluate("history.back()")
        expect(page.get_by_role("dialog", name="تغييرات غير محفوظة")).to_be_visible()
        page.get_by_role("dialog").get_by_role("button", name="البقاء في الصفحة").click()
        expect(page.get_by_label("حجم المؤقت")).to_have_value("1.1")

    def test_room_creation_identity_image_and_archive(self):
        _, store, page = self.setup_page()
        page.goto(self.base + "/admin.html?view=rooms")
        page.locator(".room-add-tile").click()
        page.get_by_label("اسم الغرفة").fill("غرفة التجربة")
        page.get_by_label("مدة اللعبة الافتراضية بالدقائق").fill("45")
        page.get_by_role("button", name="إنشاء الغرفة").click()
        expect(page).to_have_url(re.compile(r"view=room&id=room-[a-z0-9]+&tab=settings"))
        room_id = parse_qs(urlparse(page.url).query)["id"][0]
        self.assertEqual(store.rooms[-1]["default_duration_seconds"], 2700)
        self.assertEqual(page.locator(".room-settings-form input[type=file]").count(), 1)
        page.locator(".room-settings-form input[type=file]").set_input_files(str(ROOT / "images" / "prison.jpg"))
        page.get_by_label("اسم الغرفة").fill("غرفة باسم جديد")
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        expect(page.get_by_text("حُفظت جميع التغييرات.")).to_be_visible()
        row = next(r for r in store.rooms if r["id"] == room_id)
        self.assertEqual(row["name"], "غرفة باسم جديد")
        self.assertEqual(row["thumbnail_ref"], row["background_ref"])
        self.assertTrue(row["thumbnail_ref"].startswith("storage://room-assets/"))
        page.get_by_role("switch", name="حالة الغرفة").uncheck()
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        self.assertFalse(row["is_active"])
        page.goto(self.base + "/admin.html?view=new-room")
        page.get_by_label("اسم الغرفة").fill("غرفة التجربة")
        page.get_by_role("button", name="إنشاء الغرفة").click()
        expect(page).to_have_url(re.compile(re.escape(room_id) + r"-2&tab=settings"))

    def test_long_hint_drag_stages_once(self):
        _, store, page = self.setup_page(viewport={"width": 1100, "height": 650})
        store.hints[:] = [{"id": str(uuid.uuid4()), "room_id": "anbar",
                           "body": f"تلميح {n+1}", "display_order": n} for n in range(40)]
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=hints")
        expect(page.locator(".workspace-row")).to_have_count(40)
        page.locator(".workspace-row").last.locator("[data-drag-handle]").drag_to(
            page.locator(".workspace-row").first.locator("[data-drag-handle]"))
        expect(page.locator(".workspace-row").first).to_contain_text("تلميح 40")
        self.assertEqual(store.calls, [])
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        self.assertEqual(len(store.calls), 1)
        self.assertEqual(store.hints[0]["body"], "تلميح 40")

    def test_touch_drag_on_mobile_stages_until_save(self):
        context, store, page = self.setup_page(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        store.hints[:] = [{"id": str(uuid.uuid4()), "room_id": "anbar",
                           "body": f"لمس {n+1}", "display_order": n} for n in range(2)]
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=hints")
        expect(page.locator(".workspace-row")).to_have_count(2)
        source = page.locator(".workspace-row").last.locator("[data-drag-handle]")
        target = page.locator(".workspace-row").first.locator("[data-drag-handle]")
        source.scroll_into_view_if_needed()
        a, b = source.bounding_box(), target.bounding_box()
        self.assertIsNotNone(a)
        self.assertIsNotNone(b)
        x, y = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
        end_y = b["y"] + 4
        cdp = context.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                                              "touchPoints": [{"x": x, "y": y}]})
        for step in range(1, 7):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                                                  "touchPoints": [{"x": x, "y": y + (end_y-y)*step/6}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        expect(page.locator(".workspace-row").first).to_contain_text("لمس 2")
        self.assertEqual(store.calls, [])
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        self.assertEqual(len(store.calls), 1)
        self.assertEqual(store.hints[0]["body"], "لمس 2")

    def test_automatic_media_assignment_change_and_removal(self):
        _, store, page = self.setup_page()
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=audio")
        hint_card = page.locator(".automatic-media-card").filter(has_text="صوت إشعار التلميح")
        expect(hint_card.get_by_text("مُعد", exact=True)).to_be_visible()
        hint_card.get_by_role("button", name="تغيير صوت إشعار التلميح").click()
        page.locator(".admin-dialog input[type=file]").set_input_files({
            "name": "new-hint.mp3", "mimeType": "audio/mpeg", "buffer": b"sound"})
        page.get_by_role("button", name="إضافة إلى المسودة").click()
        page.get_by_role("link", name="المقاطع").click()
        page.get_by_role("button", name="إضافة مقطع الخسارة").click()
        page.locator(".admin-dialog input[type=file]").set_input_files({
            "name": "loss.webm", "mimeType": "video/webm", "buffer": b"video"})
        page.get_by_role("button", name="إضافة إلى المسودة").click()
        expect(page.locator(".automatic-media-card video")).to_have_count(1)
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        expect(page.get_by_text("حُفظت جميع التغييرات.")).to_be_visible()
        current = [m for m in store.media if m["room_id"] == "anbar"]
        self.assertTrue(next(m for m in current if m["kind"] == "hint_sound")
                        ["asset_ref"].startswith("storage://room-assets/"))
        self.assertEqual(len([m for m in current if m["kind"] == "lose_video"]), 1)
        page.get_by_role("button", name="إزالة مقطع الخسارة").click()
        page.get_by_role("link", name="الأصوات").click()
        page.locator(".automatic-media-card").filter(has_text="صوت إشعار التلميح").get_by_role(
            "button", name="إزالة صوت إشعار التلميح").click()
        page.get_by_role("button", name="حفظ جميع التغييرات").click()
        expect(page.get_by_text("حُفظت جميع التغييرات.")).to_be_visible()
        current = [m for m in store.media if m["room_id"] == "anbar"]
        self.assertEqual(len([m for m in current if m["kind"] in ("hint_sound", "lose_video")]), 0)

    def test_duplicate_save_is_suppressed(self):
        _, store, page = self.setup_page()
        page.goto(self.base + "/admin.html?view=room&id=anbar&tab=settings")
        page.get_by_label("اسم الغرفة").fill("اسم واحد")
        page.evaluate("""() => {
            const button = document.querySelector('.room-savebar .button-dark');
            button.click(); button.click();
        }""")
        expect(page.locator('.room-draft-status')).to_contain_text(re.compile("محفوظة|حُفظت"))
        expect(page.locator('.room-savebar .button-dark')).to_be_disabled()
        self.assertEqual(len(store.calls), 1)
        self.assertEqual(store.rooms[0]["name"], "اسم واحد")


if __name__ == "__main__":
    unittest.main()
