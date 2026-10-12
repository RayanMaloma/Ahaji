"""Staff invitation and role/room management UI with a stateful API fixture."""
import copy
import functools
import http.server
import json
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import DASHBOARD_STAFF, install_auth_mock

ROOT=pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version="HTTP/1.1"

    def log_message(self,*_args):pass


class StaffManagementBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler=functools.partial(QuietHandler,directory=str(ROOT))
        cls.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),handler)
        cls.base=f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.playwright=sync_playwright().start()
        cls.browser=cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.playwright.stop();cls.server.shutdown();cls.server.server_close()

    def test_invite_assign_deactivate(self):
        staff=copy.deepcopy(DASHBOARD_STAFF)
        context=self.browser.new_context()
        self.addCleanup(context.close)
        install_auth_mock(context,dashboard=True)
        headers={"content-type":"application/json","access-control-allow-origin":"*"}

        def directory(route):
            route.fulfill(status=200,headers=headers,body=json.dumps(staff))

        def invite(route):
            body=route.request.post_data_json
            staff.append({"user_id":"00000000-0000-4000-8000-000000000099",
                          "email":body["email"],"email_confirmed":False,"role":body["role"],
                          "active":True,"account_type":"email","login_name":None,
                          "display_name":None,"avatar_ref":None,
                          "created_at":"2026-10-11T00:00:00Z","room_ids":body["room_ids"]})
            route.fulfill(status=200,headers=headers,body='{"status":"invited"}')

        def manage(route):
            body=route.request.post_data_json
            person=next(s for s in staff if s["user_id"]==body["p_user_id"])
            person.update(role=body["p_role"],active=body["p_active"],room_ids=body["p_room_ids"])
            route.fulfill(status=200,headers=headers,body="null")

        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_staff_directory",directory)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/functions/v1/staff-invite",invite)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_manage_staff",manage)
        page=context.new_page()
        page.goto(self.base+"/admin.html?view=staff")
        page.get_by_role("button",name="إضافة عضو",exact=False).click()
        page.get_by_role("combobox",name="طريقة الدخول").select_option("email")
        page.get_by_role("textbox",name="البريد الإلكتروني").fill("newgm@test.invalid")
        page.locator(".staff-room-choices input[value=anbar]").check()
        page.get_by_role("button",name="إنشاء الحساب").click()
        expect(page.get_by_text("newgm@test.invalid")).to_be_visible()
        row=page.locator(".staff-table tbody tr").filter(has_text="newgm@test.invalid")
        expect(row).to_contain_text("بانتظار توثيق البريد")
        row.get_by_role("button",name="إدارة").click()
        page.get_by_role("checkbox",name="الحساب نشط").uncheck()
        page.get_by_role("button",name="حفظ الصلاحيات").click()
        self.assertFalse(next(s for s in staff if s["email"]=="newgm@test.invalid")["active"])

    def test_operator_provision_room_scope_deactivate_and_reset(self):
        staff=copy.deepcopy(DASHBOARD_STAFF)
        context=self.browser.new_context()
        self.addCleanup(context.close)
        install_auth_mock(context,dashboard=True)
        headers={"content-type":"application/json","access-control-allow-origin":"*"}
        calls=[]

        def directory(route):
            route.fulfill(status=200,headers=headers,body=json.dumps(staff))

        def operator(route):
            body=route.request.post_data_json
            calls.append(body)
            if body["action"]=="create":
                staff.append({"user_id":"00000000-0000-4000-8000-000000000099",
                              "email":None,"email_confirmed":False,"role":"game_master",
                              "active":True,"account_type":"operator","login_name":body["username"],
                              "display_name":None,"avatar_ref":None,
                              "created_at":"2026-10-12T00:00:00Z","room_ids":body["room_ids"]})
                payload={"username":body["username"]+"@ahaji.com","password":"fixture-once-only"}
            else:
                payload={"password":"fixture-reset-only"}
            route.fulfill(status=200,headers=headers,body=json.dumps(payload))

        def manage(route):
            body=route.request.post_data_json
            person=next(s for s in staff if s["user_id"]==body["p_user_id"])
            person.update(role=body["p_role"],active=body["p_active"],room_ids=body["p_room_ids"])
            route.fulfill(status=200,headers=headers,body="null")

        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_staff_directory",directory)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/functions/v1/operator-account",operator)
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/admin_manage_staff",manage)
        page=context.new_page()
        page.goto(self.base+"/admin.html?view=staff")
        page.get_by_role("button",name="إضافة عضو",exact=False).click()
        page.get_by_role("textbox",name="اسم المستخدم · ‎@ahaji.com").fill("qaoperator")
        page.get_by_role("checkbox",name="السجن").check()
        page.get_by_role("button",name="إنشاء الحساب").click()
        expect(page.get_by_text("fixture-once-only")).to_be_visible()
        self.assertEqual(calls[0]["room_ids"],["anbar"])
        page.get_by_role("button",name="إغلاق").click()
        row=page.locator(".staff-table tbody tr").filter(has_text="qaoperator@ahaji.com")
        expect(row).to_contain_text("السجن")
        row.get_by_role("button",name="إدارة").click()
        expect(page.get_by_role("combobox",name="الدور").locator("option")).to_have_count(1)
        page.get_by_role("checkbox",name="الحساب نشط").uncheck()
        page.get_by_role("button",name="حفظ الصلاحيات").click()
        self.assertFalse(next(s for s in staff if s.get("login_name")=="qaoperator")["active"])
        page.on("dialog",lambda dialog:dialog.accept())
        row=page.locator(".staff-table tbody tr").filter(has_text="qaoperator@ahaji.com")
        row.get_by_role("button",name="إعادة تعيين كلمة المرور").click()
        expect(page.get_by_text("fixture-reset-only")).to_be_visible()
        page.get_by_role("dialog").get_by_role("button",name="إغلاق").click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        self.assertEqual(calls[-1]["action"],"reset")


if __name__=="__main__":unittest.main()
