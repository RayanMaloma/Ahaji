"""Admin room CRUD and dynamic GM availability with stateful HTTP fixtures."""

import copy
import base64
import functools
import http.server
import io
import json
import pathlib
import threading
import unittest
import uuid
import wave
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
                if any(r["id"]==request.post_data_json["id"] for r in rooms):
                    route.fulfill(status=409,headers=headers,
                                  body='{"code":"23505","message":"duplicate key"}')
                    return
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
        expect(page.get_by_role("textbox",name=re.compile("المعرّف الداخلي"))).to_have_count(0)
        page.get_by_label("اسم الغرفة").fill("غرفة التجربة")
        page.get_by_label("الوصف").fill("وصف الغرفة")
        page.get_by_label("مدة اللعبة الافتراضية بالدقائق").fill("45")
        page.get_by_role("button", name="إنشاء الغرفة").click()
        expect(page).to_have_url(re.compile(r"/admin.html\?view=room&id=room-[a-z0-9]+&tab=settings"))
        room_id=parse_qs(urlparse(page.url).query)["id"][0]
        expect(page.get_by_role("textbox",name="اسم الغرفة")).to_have_value("غرفة التجربة")
        self.assertEqual(next(r for r in rooms if r["id"] == room_id)["default_duration_seconds"], 2700)
        expect(page.get_by_text("صورة الغرفة",exact=True)).to_have_count(1)
        self.assertEqual(page.locator(".room-settings-form input[type=file]").count(),1)
        page.locator(".room-settings-form input[type=file]").set_input_files(str(ROOT / "images" / "prison.jpg"))
        preview=page.frame_locator(".cast-preview-frame")
        expect(preview.locator("[data-cast-bg]")).to_have_attribute("src",re.compile(r"^blob:"))
        page.get_by_label("حجم المؤقت").fill("1.2")
        expect(preview.locator("[data-cast-stage]")).to_have_attribute("style",re.compile(r"--cast-timer-scale: 1.2"))
        page.get_by_role("button",name="حفظ التغييرات").click()
        expect(page.locator(".upload-preview img")).to_have_attribute("src",re.compile(r"room-assets"))
        saved=next(r for r in rooms if r["id"]==room_id)
        self.assertEqual(saved["thumbnail_ref"],saved["background_ref"])
        self.assertTrue(saved["thumbnail_ref"].startswith("storage://room-assets/"))

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
        handle=page.locator(".workspace-row").filter(has_text="تلميح ثانٍ").locator("[data-drag-handle]")
        handle.drag_to(page.locator(".workspace-row").first.locator("[data-drag-handle]"))
        expect(page.locator(".workspace-row").first).to_contain_text("تلميح ثانٍ")
        expect(page.locator(".workspace-list")).not_to_have_class(re.compile("is-saving"))
        handle=page.locator(".workspace-row").filter(has_text="تلميح ثانٍ").locator("[data-drag-handle]")
        handle.focus();handle.press("Space");handle.press("End");handle.press("Enter")
        expect(page.locator(".workspace-row").last).to_contain_text("تلميح ثانٍ")
        gm_hints=context.new_page()
        gm_hints.goto(self.base+"/index.html")
        gm_hints.locator(f".room-card[data-room='{room_id}']").click()
        gm_hints.locator("#btn-show-hints").click()
        expect(gm_hints.locator("#saved-hints-list li")).to_have_count(2)
        self.assertIn("اختبر المفتاح الجديد",gm_hints.locator("#saved-hints-list li").first.inner_text())
        gm_hints.close()
        page.on("dialog",lambda dialog:dialog.accept())
        page.locator(".workspace-row").filter(has_text="تلميح ثانٍ").get_by_role("button",name="حذف").click()
        expect(page.get_by_text("تلميح ثانٍ")).to_have_count(0)

        page.get_by_role("link",name="الصور").click()
        page.get_by_role("button",name="إضافة صورة",exact=False).click()
        page.get_by_role("textbox",name="اسم الملف").fill("اختبار الصورة")
        page.locator(".admin-dialog input[type=file]").set_input_files(str(ROOT / "images" / "prison.jpg"))
        page.get_by_role("button",name="رفع وحفظ").click()
        expect(page.get_by_text("اختبار الصورة")).to_be_visible()
        self.assertEqual(len([m for m in media if m["room_id"]==room_id]),1)
        page.locator(".workspace-media-card").filter(has_text="اختبار الصورة").get_by_role("button",name="استبدال").click()
        page.get_by_role("textbox",name="اسم الملف").fill("صورة محدثة")
        page.locator(".admin-dialog input[type=file]").set_input_files(str(ROOT / "images" / "pyramid.png"))
        page.get_by_role("button",name="استبدال وحفظ").click()
        expect(page.get_by_text("صورة محدثة")).to_be_visible()
        self.assertEqual(next(m for m in media if m["room_id"]==room_id)["label"],"صورة محدثة")

        page.get_by_role("link",name="الإعدادات العامة").click()
        page.get_by_label("اسم الغرفة").fill("غرفة جديدة")
        page.get_by_role("button", name="حفظ التغييرات").click()
        expect(page.get_by_label("اسم الغرفة")).to_have_value("غرفة جديدة")
        self.assertEqual(next(r for r in rooms if r["id"] == room_id)["name"], "غرفة جديدة")
        self.assertEqual(parse_qs(urlparse(page.url).query)["id"][0],room_id)

        gm = context.new_page()
        gm.goto(self.base + "/index.html")
        expect(gm.locator(f".room-card[data-room='{room_id}']")).to_be_visible()
        gm.locator(f".room-card[data-room='{room_id}']").click()
        expect(gm.locator("#gm-room-name")).to_have_text("غرفة جديدة")

        page.bring_to_front()
        page.get_by_role("link",name="الصور").click()
        page.locator(".workspace-media-card").filter(has_text="صورة محدثة").get_by_role("button",name="حذف").click()
        expect(page.get_by_text("صورة محدثة")).to_have_count(0)
        self.assertEqual(len([m for m in media if m["room_id"]==room_id]),0)
        page.get_by_role("link",name="الإعدادات العامة").click()
        page.get_by_role("switch",name="حالة الغرفة").uncheck()
        page.get_by_role("button",name="حفظ التغييرات").click()
        expect(page.get_by_role("switch",name="حالة الغرفة")).not_to_be_checked()
        after_archive = context.new_page()
        after_archive.goto(self.base + "/index.html")
        expect(after_archive.locator(f".room-card[data-room='{room_id}']")).to_have_count(0)

        page.goto(self.base+"/admin.html?view=new-room")
        page.get_by_label("اسم الغرفة").fill("غرفة التجربة")
        page.get_by_role("button",name="إنشاء الغرفة").click()
        expect(page).to_have_url(re.compile(rf"id={re.escape(room_id)}-2&tab=settings"))
        self.assertEqual(len([r for r in rooms if r["id"]==room_id]),1)

        page.goto(self.base+"/admin.html?view=room&id=anbar&tab=audio")
        player=page.locator(".system-media-row .ahaji-audio-player").first
        expect(player).to_be_visible()
        self.assertFalse(player.locator("audio").evaluate("el=>el.hasAttribute('controls')"))
        expect(player.locator(".audio-seek")).to_be_disabled()
        player.locator(".audio-play").click()
        expect(player.locator(".audio-play")).to_have_attribute("aria-label",re.compile("إيقاف مؤقت"))
        player.locator(".audio-play").click()
        expect(player.locator(".audio-play")).to_have_attribute("aria-label",re.compile("تشغيل"))
        player.locator(".audio-mute").click()
        self.assertTrue(player.locator("audio").evaluate("el=>el.muted"))

        sound=io.BytesIO()
        with wave.open(sound,"wb") as wav:
            wav.setnchannels(1);wav.setsampwidth(1);wav.setframerate(8000)
            wav.writeframes(bytes([128])*16000)
        source="data:audio/wav;base64,"+base64.b64encode(sound.getvalue()).decode()
        page.evaluate("""async source=>{
          const {createAudioPlayer}=await import('/js/admin/audio-player.mjs');
          document.body.append(createAudioPlayer({src:source,label:'تجربة الانتقال'}));
          document.body.append(createAudioPlayer({src:'',label:'صوت مفقود'}));
        }""",source)
        seekable=page.locator(".ahaji-audio-player").filter(has_text="تجربة الانتقال")
        expect(seekable.locator(".audio-seek")).to_be_enabled()
        seekable.locator(".audio-seek").evaluate(
            "el=>{el.value='500';el.dispatchEvent(new Event('input',{bubbles:true}))}")
        self.assertGreater(seekable.locator("audio").evaluate("el=>el.currentTime"),0)
        expect(page.locator(".ahaji-audio-player").filter(has_text="صوت مفقود").locator(".audio-play")).to_be_disabled()

        geometry=[]
        for view in ["rooms","staff","history","account"]:
            page.goto(self.base+f"/admin.html?view={view}")
            expect(page.locator(".admin-sidebar")).to_be_visible()
            geometry.append(page.locator(".admin-sidebar").evaluate(
                "el=>{const r=el.getBoundingClientRect();return [r.x,r.width]}"))
        self.assertEqual(geometry,[geometry[0]]*len(geometry))
        page.goto(self.base+"/admin.html?view=room&id=anbar&tab=settings")
        expect(page.get_by_role("heading",name="تعديل الغرفة")).to_be_visible()
        self.assertEqual(page.locator(".admin-main").evaluate("el=>getComputedStyle(el).scrollbarWidth"),"none")
        self.assertGreater(page.locator(".admin-main").evaluate(
            "el=>{el.scrollTop=500;return el.scrollTop}"),0)
        page.locator(".admin-main").evaluate("el=>el.scrollTop=0")
        page.locator(".admin-main").focus()
        page.keyboard.press("PageDown")
        self.assertGreater(page.locator(".admin-main").evaluate("el=>el.scrollTop"),0)

    def test_long_hint_drag_persists_once_and_failed_save_restores_order(self):
        context=self.browser.new_context(viewport={"width":1100,"height":650})
        self.addCleanup(context.close)
        install_auth_mock(context,dashboard=True)
        hints=[{"id":str(uuid.uuid4()),"room_id":"anbar","body":f"تلميح {index+1}",
                "display_order":index} for index in range(40)]
        calls=[];reject={"value":False}
        headers={"content-type":"application/json","access-control-allow-origin":"*"}
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/room_hints**",
                      lambda route:route.fulfill(status=200,headers=headers,body=json.dumps(hints)))
        def reorder(route):
            ids=route.request.post_data_json["p_ids"]
            calls.append(ids)
            if reject["value"]:
                route.fulfill(status=500,headers=headers,body='{"message":"Save failed"}')
            else:
                for position,id in enumerate(ids):
                    next(h for h in hints if h["id"]==id)["display_order"]=position
                route.fulfill(status=200,headers=headers,body="null")
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_reorder_hints",reorder)
        page=context.new_page()
        page.goto(self.base+"/admin.html?view=room&id=anbar&tab=hints")
        expect(page.locator(".workspace-row")).to_have_count(40)
        last=page.locator(".workspace-row").last.locator("[data-drag-handle]")
        first=page.locator(".workspace-row").first.locator("[data-drag-handle]")
        last.drag_to(first)
        expect(page.locator(".workspace-row").first).to_contain_text("تلميح 40")
        expect(page.locator(".workspace-list")).not_to_have_class(re.compile("is-saving"))
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][0],hints[-1]["id"])
        reject["value"]=True
        page.locator(".workspace-row").first.locator("[data-drag-handle]").drag_to(
            page.locator(".workspace-row").last.locator("[data-drag-handle]"))
        expect(page.locator(".form-message.error")).to_be_visible()
        expect(page.locator(".workspace-row").first).to_contain_text("تلميح 40")
        self.assertEqual(len(calls),2)

    def test_touch_drag_on_mobile(self):
        context=self.browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
        self.addCleanup(context.close)
        install_auth_mock(context,dashboard=True)
        hints=[{"id":str(uuid.uuid4()),"room_id":"anbar","body":f"لمس {i+1}",
                "display_order":i} for i in range(2)]
        headers={"content-type":"application/json","access-control-allow-origin":"*"}
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/room_hints**",
                      lambda route:route.fulfill(status=200,headers=headers,body=json.dumps(hints)))
        calls=[]
        def reorder(route):
            calls.append(route.request.post_data_json["p_ids"])
            route.fulfill(status=200,headers=headers,body="null")
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_reorder_hints",reorder)
        page=context.new_page()
        page.goto(self.base+"/admin.html?view=room&id=anbar&tab=hints")
        expect(page.locator(".workspace-row")).to_have_count(2)
        source=page.locator(".workspace-row").last.locator("[data-drag-handle]")
        target=page.locator(".workspace-row").first.locator("[data-drag-handle]")
        source.scroll_into_view_if_needed()
        a=source.bounding_box();b=target.bounding_box()
        self.assertIsNotNone(a);self.assertIsNotNone(b)
        x=a["x"]+a["width"]/2;y=a["y"]+a["height"]/2
        end_y=b["y"]+4
        cdp=context.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
        for step in range(1,7):
            cdp.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[
                {"x":x,"y":y+(end_y-y)*step/6}]})
        cdp.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
        expect(page.locator(".workspace-row").first).to_contain_text("لمس 2")
        self.assertEqual(len(calls),1)


if __name__ == "__main__":
    unittest.main()
