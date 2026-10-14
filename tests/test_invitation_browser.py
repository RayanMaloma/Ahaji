"""Staff invitation UI and first-login activation (mocked Supabase, real Chromium).

The Edge Function, Auth verify/update endpoints, and invitation RPCs are
stateful fakes in this harness. No live Supabase project or mailbox is used.
"""

import copy
import functools
import http.server
import json
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import DASHBOARD_STAFF, install_auth_mock, session

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://gbhleqizxcmxmutgcjon.supabase.co"
JSON = {"content-type": "application/json", "access-control-allow-origin": "*"}
INVITATION = "11111111-1111-4111-8111-111111111111"
STRONG = "Maze-Door-2026x"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


class InvitationBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def context(self, **options):
        context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        install_auth_mock(context, **options)
        self.addCleanup(context.close)
        return context

    # ---- Admin Staff page -------------------------------------------------
    def admin_with_invitations(self):
        staff = copy.deepcopy(DASHBOARD_STAFF)
        calls = []
        context = self.context(dashboard=True)

        def directory(route):
            route.fulfill(status=200, headers=JSON, body=json.dumps(staff))

        def invite(route):
            body = route.request.post_data_json
            calls.append(body)
            if body["action"] == "invite":
                if body["email"] == "taken@test.invalid":
                    route.fulfill(status=409, headers=JSON, body=json.dumps(
                        {"error": "هذا البريد مرتبط بحساب فريق أو بدعوة قائمة."}))
                    return
                staff.append({"user_id": "00000000-0000-4000-8000-000000000099", "email": body["email"],
                              "email_confirmed": False, "role": body["role"], "active": False,
                              "account_type": "email", "login_name": None, "display_name": body["display_name"],
                              "avatar_ref": None, "created_at": "2026-10-14T00:00:00Z",
                              "room_ids": body["room_ids"], "invitation_id": INVITATION,
                              "invitation_status": "pending", "invitation_expires_at": "2026-10-15T12:00:00Z",
                              "invitation_sent_at": "2026-10-14T12:00:00Z"})
                reply = {"status": "pending", "invitation_id": INVITATION, "email": body["email"]}
            elif body["action"] == "revoke":
                next(s for s in staff if s.get("invitation_id") == body["invitation_id"])["invitation_status"] = "revoked"
                reply = {"status": "revoked"}
            else:
                reply = {"status": "pending", "invitation_id": body["invitation_id"]}
            route.fulfill(status=200, headers=JSON, body=json.dumps(reply))

        def manage(route):
            calls.append({"manage": route.request.post_data_json})
            route.fulfill(status=200, headers=JSON, body="null")

        context.route(f"{API}/rest/v1/rpc/admin_staff_directory", directory)
        context.route(f"{API}/functions/v1/staff-invite", invite)
        context.route(f"{API}/rest/v1/rpc/admin_manage_staff", manage)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=staff")
        expect(page.get_by_role("heading", level=1)).to_have_text("فريق العمل")
        return page, calls, staff

    def open_invite_dialog(self, page):
        page.get_by_role("button", name="إضافة عضو", exact=False).click()
        page.get_by_role("combobox", name="طريقة الدخول").select_option("email")

    def test_admin_invites_member_with_name_role_and_rooms(self):
        page, calls, _ = self.admin_with_invitations()
        self.open_invite_dialog(page)
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("button", name="إرسال الدعوة")).to_be_visible()
        dialog.get_by_role("textbox", name="الاسم").fill("سارة العتيبي")
        dialog.get_by_role("textbox", name="البريد الإلكتروني").fill("Sara@Test.invalid")
        dialog.get_by_role("checkbox", name="السجن").check()
        dialog.get_by_role("button", name="إرسال الدعوة").click()
        expect(dialog.get_by_role("status").filter(has_text="أُرسلت الدعوة")).to_be_visible()
        body = calls[0]
        self.assertEqual(body["action"], "invite")
        self.assertEqual(body["display_name"], "سارة العتيبي")
        self.assertEqual(body["role"], "game_master")
        self.assertEqual(body["room_ids"], ["anbar"])
        self.assertTrue(body["redirect_to"].endswith("/activate.html"))
        self.assertNotIn("password", json.dumps(body).lower())
        dialog.get_by_role("button", name="إغلاق").click()
        row = page.locator(".staff-table tbody tr").filter(has_text="سارة العتيبي")
        expect(row).to_contain_text("بانتظار التفعيل")
        expect(row).to_contain_text("تنتهي")
        expect(row.get_by_role("button", name="إعادة إرسال الدعوة")).to_be_visible()

    def test_invite_errors_are_shown_in_the_form(self):
        page, _, _ = self.admin_with_invitations()
        self.open_invite_dialog(page)
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="البريد الإلكتروني").fill("taken@test.invalid")
        dialog.get_by_role("button", name="إرسال الدعوة").click()
        expect(dialog.get_by_text("هذا البريد مرتبط بحساب فريق أو بدعوة قائمة.")).to_be_visible()
        expect(dialog.get_by_role("button", name="إرسال الدعوة")).to_be_enabled()

    def test_resend_revoke_and_pending_editor(self):
        page, calls, _ = self.admin_with_invitations()
        self.open_invite_dialog(page)
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="الاسم").fill("نورة")
        dialog.get_by_role("textbox", name="البريد الإلكتروني").fill("noura@test.invalid")
        dialog.get_by_role("button", name="إرسال الدعوة").click()
        expect(dialog.get_by_text("أُرسلت الدعوة")).to_be_visible()
        dialog.get_by_role("button", name="إغلاق").click()
        page.on("dialog", lambda d: d.accept())
        row = page.locator(".staff-table tbody tr").filter(has_text="نورة")
        row.get_by_role("button", name="إدارة").click()
        editor = page.get_by_role("dialog")
        expect(editor.get_by_role("checkbox", name="الحساب نشط")).to_have_count(0)
        expect(editor.get_by_text("يُفعَّل الحساب عندما يكمل العضو")).to_be_visible()
        editor.get_by_role("button", name="حفظ الصلاحيات").click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        self.assertFalse(calls[-1]["manage"]["p_active"], "pending accounts are never switched on by Admin")
        row.get_by_role("button", name="إعادة إرسال الدعوة").click()
        page.wait_for_function("() => true")
        expect(row.get_by_role("button", name="إلغاء الدعوة")).to_be_visible()
        self.assertEqual(calls[-1]["action"], "resend")
        self.assertEqual(calls[-1]["invitation_id"], INVITATION)
        row.get_by_role("button", name="إلغاء الدعوة").click()
        expect(row).to_contain_text("دعوة ملغاة")
        self.assertEqual(calls[-1]["action"], "revoke")
        expect(row.get_by_role("button", name="دعوة مجدداً")).to_be_visible()

    # ---- Activation page --------------------------------------------------
    def activation(self, invitation, verify_status=200, accept=None, role="game_master"):
        context = self.context(authenticated=False, role=None)
        requests = []
        context.on("request", lambda r: requests.append((r.method, r.url, r.post_data or "")))
        state = {"password": False}

        def verify(route):
            if verify_status != 200:
                route.fulfill(status=verify_status, headers=JSON, body=json.dumps(
                    {"code": 403, "error_code": "otp_expired", "msg": "Email link is invalid or has expired"}))
            else:
                route.fulfill(status=200, headers=JSON, body=json.dumps(session()))

        def mine(route):
            row = dict(invitation, password_set=state["password"]) if invitation else None
            route.fulfill(status=200, headers=JSON, body=json.dumps([row] if row else []))

        def user(route):
            if route.request.method == "PUT":
                state["password"] = True
            route.fulfill(status=200, headers=JSON, body=json.dumps(session()["user"]))

        def accepted(route):
            reply = accept or ({"status": "accepted", "role": role} if state["password"]
                               else {"status": "password_required"})
            route.fulfill(status=200, headers=JSON, body=json.dumps(reply))

        context.route(f"{API}/auth/v1/verify*", verify)
        context.route(f"{API}/auth/v1/user*", user)
        context.route(f"{API}/rest/v1/rpc/my_staff_invitation", mine)
        context.route(f"{API}/rest/v1/rpc/accept_staff_invitation", accepted)
        page = context.new_page()
        page.goto(self.base + "/activate.html?token_hash=pkce_fixture_token&type=invite")
        return page, requests

    def pending(self, **extra):
        return {"status": "pending", "role": "game_master", "display_name": "سارة",
                "expires_at": "2026-10-15T12:00:00Z", "email_confirmed": True, **extra}

    def test_activation_sets_password_and_routes_game_master(self):
        page, requests = self.activation(self.pending())
        expect(page.get_by_role("button", name="متابعة التفعيل")).to_be_visible()
        self.assertNotIn("token_hash", page.url, "the one-time token is removed from the address bar")
        self.assertFalse(any("/auth/v1/verify" in url for _, url, _ in requests),
                         "the link is not consumed until the invitee clicks")
        page.get_by_role("button", name="متابعة التفعيل").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("مرحباً سارة")
        password = page.get_by_label("كلمة المرور", exact=True)
        confirm = page.get_by_label("تأكيد كلمة المرور")
        password.fill("short1")
        confirm.fill("short1")
        page.get_by_role("button", name="تفعيل حسابي").click()
        expect(page.get_by_role("alert")).to_contain_text("لا تستوفي المتطلبات")
        self.assertFalse(any(m == "PUT" for m, _, _ in requests), "weak passwords never reach Auth")
        password.fill(STRONG)
        confirm.fill(STRONG + "!")
        expect(page.locator("#confirm-status")).to_have_text("كلمتا المرور غير متطابقتين")
        confirm.fill(STRONG)
        expect(page.locator("#password-rules li.met")).to_have_count(5)
        page.get_by_role("button", name="تفعيل حسابي").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("تم تفعيل حسابك")
        expect(page.get_by_role("link", name="الدخول إلى أحاجي")).to_have_attribute("href", "index.html")
        puts = [body for m, url, body in requests if m == "PUT" and "/auth/v1/user" in url]
        self.assertEqual(len(puts), 1)
        self.assertEqual(json.loads(puts[0])["password"], STRONG)
        leaked = [url for m, url, body in requests if STRONG in body and "/auth/v1/user" not in url]
        self.assertEqual(leaked, [], "the password is sent only to Supabase Auth")

    def test_activation_routes_admin(self):
        page, _ = self.activation(self.pending(role="admin"), role="admin")
        page.get_by_role("button", name="متابعة التفعيل").click()
        page.get_by_label("كلمة المرور", exact=True).fill(STRONG)
        page.get_by_label("تأكيد كلمة المرور").fill(STRONG)
        page.get_by_role("button", name="تفعيل حسابي").click()
        expect(page.get_by_role("link", name="الدخول إلى أحاجي")).to_have_attribute("href", "admin.html?view=rooms")

    def test_invalid_expired_and_revoked_links(self):
        page, _ = self.activation(self.pending(), verify_status=403)
        page.get_by_role("button", name="متابعة التفعيل").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("الرابط غير صالح أو منتهي")
        expect(page.locator("#activation-form")).to_be_hidden()
        for status, heading in (("expired", "انتهت صلاحية الدعوة"), ("revoked", "الدعوة ملغاة")):
            page, _ = self.activation(self.pending(status=status))
            page.get_by_role("button", name="متابعة التفعيل").click()
            expect(page.get_by_role("heading", level=1)).to_have_text(heading)
            expect(page.locator("#activation-form")).to_be_hidden()
            expect(page.get_by_role("link", name="العودة إلى تسجيل الدخول")).to_be_visible()

    def test_server_expiry_during_submission_is_reported(self):
        page, _ = self.activation(self.pending(), accept={"status": "expired"})
        page.get_by_role("button", name="متابعة التفعيل").click()
        page.get_by_label("كلمة المرور", exact=True).fill(STRONG)
        page.get_by_label("تأكيد كلمة المرور").fill(STRONG)
        page.get_by_role("button", name="تفعيل حسابي").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("انتهت صلاحية الدعوة")

    # ---- First-login enforcement -------------------------------------------
    def pending_signed_in(self):
        context = self.context(authenticated=True, role=None)
        context.route(f"{API}/rest/v1/rpc/my_staff_invitation", lambda route: route.fulfill(
            status=200, headers=JSON, body=json.dumps([self.pending(password_set=False)])))
        return context

    def test_pending_invitee_is_sent_to_activation_everywhere(self):
        context = self.pending_signed_in()
        for path in ("/admin.html?view=rooms", "/index.html", "/gm.html?room=anbar", "/login.html"):
            page = context.new_page()
            page.goto(self.base + path)
            expect(page).to_have_url(self.base + "/activate.html")
            page.close()

    def test_signed_in_without_invitation_still_goes_to_unauthorized(self):
        page = self.context(authenticated=True, role=None).new_page()
        page.goto(self.base + "/index.html")
        expect(page).to_have_url(self.base + "/unauthorized.html")


if __name__ == "__main__":
    unittest.main()
