"""Admin room CRUD and dynamic GM availability with stateful HTTP fixtures."""

import copy
import functools
import http.server
import json
import pathlib
import threading
import unittest
import uuid
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright
from auth_fixture import DASHBOARD_ROOMS, DASHBOARD_HINTS, DASHBOARD_MEDIA, install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass


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

    def test_create_edit_hints_archive_and_gm_catalog(self):
        rooms = copy.deepcopy(DASHBOARD_ROOMS)
        hints = copy.deepcopy(DASHBOARD_HINTS)
        media = copy.deepcopy(DASHBOARD_MEDIA)
        context = self.browser.new_context()
        self.addCleanup(context.close)
        install_auth_mock(context, dashboard=True)
        headers = {"content-type": "application/json", "access-control-allow-origin": "*"}

        def room_route(route):
            request = route.request
            wanted = parse_qs(urlparse(request.url).query).get("id", [None])[0]
            if request.method == "POST":
                row = {**request.post_data_json, "display_order": 10,
                       "created_at": "2026-10-11T00:00:00Z", "updated_at": "2026-10-11T00:00:00Z"}
                rooms.append(row)
                route.fulfill(status=201, headers=headers, body=json.dumps(row))
                return
            if request.method == "PATCH":
                row = next(r for r in rooms if wanted == "eq." + r["id"])
                row.update(request.post_data_json)
                route.fulfill(status=200, headers=headers, body=json.dumps(row))
                return
            rows = [r for r in rooms if (not wanted or wanted == "eq." + r["id"]) and
                    ("is_active=eq.true" not in request.url or r["is_active"])]
            body = rows[0] if "application/vnd.pgrst.object+json" in request.headers.get("accept", "") and rows else rows
            route.fulfill(status=200, headers=headers, body=json.dumps(body))

        def hint_route(route):
            request = route.request
            wanted = parse_qs(urlparse(request.url).query).get("id", [None])[0]
            if request.method == "POST":
                row = {**request.post_data_json, "id": str(uuid.uuid4())}
                hints.append(row)
                route.fulfill(status=201, headers=headers, body=json.dumps(row))
            elif request.method == "PATCH":
                row = next(h for h in hints if wanted == "eq." + h["id"])
                row.update(request.post_data_json)
                route.fulfill(status=200, headers=headers, body=json.dumps(row))
            elif request.method == "DELETE":
                hints[:] = [h for h in hints if wanted != "eq." + h["id"]]
                route.fulfill(status=204, headers=headers, body="")
            else:
                route.fulfill(status=200, headers=headers, body=json.dumps(hints))

        def media_route(route):
            request=route.request
            wanted=parse_qs(urlparse(request.url).query).get("id",[None])[0]
            if request.method == "POST":
                row={**request.post_data_json,"id":str(uuid.uuid4())}
                media.append(row)
                route.fulfill(status=201,headers=headers,body=json.dumps(row))
            elif request.method == "PATCH":
                row=next(m for m in media if wanted=="eq."+m["id"])
                row.update(request.post_data_json)
                route.fulfill(status=200,headers=headers,body=json.dumps(row))
            elif request.method == "DELETE":
                media[:]=[m for m in media if wanted!="eq."+m["id"]]
                route.fulfill(status=204,headers=headers,body="")
            else:
                route.fulfill(status=200,headers=headers,body=json.dumps(media))

        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rooms**", room_route)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/room_hints**", hint_route)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/room_media**", media_route)
        def reorder_route(route):
            ids=route.request.post_data_json["p_ids"]
            for index,id in enumerate(ids):
                next(h for h in hints if h["id"]==id)["display_order"]=index
            route.fulfill(status=200,headers=headers,body="null")
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_reorder_hints",reorder_route)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/storage/v1/object/room-assets/**",
                      lambda route: route.fulfill(status=200,headers=headers,body='{"Key":"uploaded"}'))

        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        page.locator(".room-add-tile").click()
        expect(page).to_have_url(self.base + "/admin.html?view=new-room")
        page.get_by_role("textbox",name=re.compile("المعرّف الداخلي")).fill("testroom")
        page.get_by_label("اسم الغرفة").fill("غرفة التجربة")
        page.get_by_label("الوصف").fill("وصف الغرفة")
        page.get_by_label("مدة اللعبة الافتراضية بالدقائق").fill("45")
        page.get_by_role("button", name="إنشاء الغرفة").click()
        expect(page).to_have_url(self.base + "/admin.html?view=room&id=testroom&tab=settings")
        expect(page.get_by_role("textbox",name="اسم الغرفة")).to_have_value("غرفة التجربة")
        self.assertEqual(next(r for r in rooms if r["id"] == "testroom")["default_duration_seconds"], 2700)

        page.get_by_role("link",name="التلميحات").click()
        page.get_by_role("button", name="إضافة تلميح", exact=False).click()
        page.locator(".admin-dialog textarea").fill("اختبر المفتاح")
        page.get_by_role("button", name="حفظ التلميح").click()
        expect(page.get_by_text("اختبر المفتاح")).to_be_visible()
        page.locator(".workspace-row").filter(has_text="اختبر المفتاح").get_by_role("button",name="تعديل").click()
        page.locator(".admin-dialog textarea").fill("اختبر المفتاح الجديد")
        page.get_by_role("button",name="حفظ التلميح").click()
        expect(page.get_by_text("اختبر المفتاح الجديد")).to_be_visible()
        page.get_by_role("button",name="إضافة تلميح",exact=False).click()
        page.locator(".admin-dialog textarea").fill("تلميح ثانٍ")
        page.get_by_role("button",name="حفظ التلميح").click()
        page.locator(".workspace-row").filter(has_text="تلميح ثانٍ").get_by_role("button",name="رفع التلميح").click()
        expect(page.locator(".workspace-row").first).to_contain_text("تلميح ثانٍ")
        page.on("dialog",lambda dialog:dialog.accept())
        page.locator(".workspace-row").filter(has_text="تلميح ثانٍ").get_by_role("button",name="حذف").click()
        expect(page.get_by_text("تلميح ثانٍ")).to_have_count(0)

        page.get_by_role("link",name="الصور").click()
        page.get_by_role("button",name="إضافة صورة",exact=False).click()
        page.get_by_role("textbox",name="اسم الملف").fill("اختبار الصورة")
        page.locator(".admin-dialog input[type=file]").set_input_files(str(ROOT / "images" / "prison.jpg"))
        page.get_by_role("button",name="رفع وحفظ").click()
        expect(page.get_by_text("اختبار الصورة")).to_be_visible()
        self.assertEqual(len([m for m in media if m["room_id"]=="testroom"]),1)
        page.locator(".workspace-media-card").filter(has_text="اختبار الصورة").get_by_role("button",name="استبدال").click()
        page.get_by_role("textbox",name="اسم الملف").fill("صورة محدثة")
        page.locator(".admin-dialog input[type=file]").set_input_files(str(ROOT / "images" / "pyramid.png"))
        page.get_by_role("button",name="استبدال وحفظ").click()
        expect(page.get_by_text("صورة محدثة")).to_be_visible()
        self.assertEqual(next(m for m in media if m["room_id"]=="testroom")["label"],"صورة محدثة")

        page.get_by_role("link",name="الإعدادات العامة").click()
        page.get_by_label("اسم الغرفة").fill("غرفة جديدة")
        page.get_by_role("button", name="حفظ التغييرات").click()
        expect(page.get_by_label("اسم الغرفة")).to_have_value("غرفة جديدة")
        self.assertEqual(next(r for r in rooms if r["id"] == "testroom")["name"], "غرفة جديدة")

        gm = context.new_page()
        gm.goto(self.base + "/index.html")
        expect(gm.locator(".room-card[data-room='testroom']")).to_be_visible()
        gm.locator(".room-card[data-room='testroom']").click()
        expect(gm.locator("#gm-room-name")).to_have_text("غرفة جديدة")

        page.bring_to_front()
        page.get_by_role("link",name="الصور").click()
        page.locator(".workspace-media-card").filter(has_text="صورة محدثة").get_by_role("button",name="حذف").click()
        expect(page.get_by_text("صورة محدثة")).to_have_count(0)
        self.assertEqual(len([m for m in media if m["room_id"]=="testroom"]),0)
        page.get_by_role("link",name="الإعدادات العامة").click()
        page.get_by_role("switch",name="حالة الغرفة").uncheck()
        page.get_by_role("button",name="حفظ التغييرات").click()
        expect(page.get_by_role("switch",name="حالة الغرفة")).not_to_be_checked()
        after_archive = context.new_page()
        after_archive.goto(self.base + "/index.html")
        expect(after_archive.locator(".room-card[data-room='testroom']")).to_have_count(0)


if __name__ == "__main__":
    unittest.main()
