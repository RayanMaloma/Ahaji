"""Staff deletion and reserved operational accounts (mocked Supabase, real Chromium).

The staff-account-delete function and directory are stateful fakes; the
authorization rules themselves are covered by supabase/tests/staff_account_deletion.sql.
"""

import copy
import functools
import http.server
import json
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import DASHBOARD_STAFF, USER_ID, install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://gbhleqizxcmxmutgcjon.supabase.co"
JSON = {"content-type": "application/json", "access-control-allow-origin": "*"}
VENUE = "00000000-0000-4000-8000-0000000000b1"
EVENTS = "00000000-0000-4000-8000-0000000000b2"
OTHER_ADMIN = "00000000-0000-4000-8000-0000000000a2"


def staff_rows(super_admin=True):
    rows = copy.deepcopy(DASHBOARD_STAFF)
    for row in rows:
        row["operational_slot"] = None
        row["is_super_admin"] = super_admin and row["user_id"] == USER_ID
    base = {"email": None, "email_confirmed": False, "role": "game_master", "active": True,
            "account_type": "operator", "avatar_ref": None, "created_at": "2026-10-19T00:00:00Z", "is_super_admin": False}
    rows += [
        dict(base, user_id=VENUE, login_name="venue", display_name="حساب محل أحاجي", room_ids=["anbar", "saleh"], operational_slot="venue"),
        dict(base, user_id=EVENTS, login_name="events", display_name="حساب الفعاليات", room_ids=[], operational_slot="events"),
        dict(base, user_id=OTHER_ADMIN, account_type="email", login_name=None, email="second@test.invalid",
             email_confirmed=True, role="admin", display_name="مدير ثانٍ", room_ids=[], operational_slot=None),
    ]
    return rows


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


class StaffDeletionBrowserTests(unittest.TestCase):
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

    def open(self, super_admin=True, delete_status=200):
        context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.addCleanup(context.close)
        install_auth_mock(context, dashboard=True)
        staff = staff_rows(super_admin)
        calls = []

        def directory(route):
            route.fulfill(status=200, headers=JSON, body=json.dumps(staff))

        def delete(route):
            body = route.request.post_data_json
            calls.append(("delete", body))
            if delete_status == 200:
                staff[:] = [s for s in staff if s["user_id"] != body["user_id"]]
                route.fulfill(status=200, headers=JSON, body=json.dumps({"status": "deleted", "user_id": body["user_id"]}))
            else:
                route.fulfill(status=delete_status, headers=JSON, body=json.dumps({"status": "access_revoked",
                    "error": "أُزيلت صلاحيات الحساب وأُغلقت جلساته، لكن تعذّر حذف هوية الدخول. أعد المحاولة لإكمال الحذف."}))

        def manage(route):
            calls.append(("manage", route.request.post_data_json))
            route.fulfill(status=200, headers=JSON, body="null")

        def operator(route):
            calls.append(("operator", route.request.post_data_json))
            route.fulfill(status=409, headers=JSON, body=json.dumps({"error": "Username already exists"}))

        context.route(f"{API}/rest/v1/rpc/admin_staff_directory", directory)
        context.route(f"{API}/functions/v1/staff-account-delete", delete)
        context.route(f"{API}/rest/v1/rpc/admin_manage_staff", manage)
        context.route(f"{API}/functions/v1/operator-account", operator)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=staff")
        expect(page.get_by_role("heading", level=1)).to_have_text("فريق العمل")
        return page, staff, calls

    def row(self, page, text):
        return page.locator(".staff-table tbody tr").filter(has_text=text)

    def editor(self, page, text):
        self.row(page, text).get_by_role("button", name="إدارة").click()
        return page.get_by_role("dialog")

    def test_super_admin_deletes_with_named_permanent_confirmation(self):
        page, staff, calls = self.open()
        expect(self.row(page, "ليلى")).to_contain_text("المدير الرئيسي")
        dialog = self.editor(page, "gm@test.invalid")
        expect(dialog.get_by_role("checkbox", name="الحساب نشط")).to_be_visible()
        dialog.get_by_role("button", name="حذف الحساب").click()
        confirm = page.get_by_role("dialog", name="حذف الحساب نهائياً")
        expect(confirm.get_by_text("gm@test.invalid")).to_have_count(2)
        expect(confirm.get_by_text("الحذف نهائي ولا يمكن التراجع عنه")).to_be_visible()
        expect(confirm.get_by_text("يبقى سجل الجلسات والأحداث والتدقيق محفوظاً")).to_be_visible()
        final = confirm.get_by_role("button", name="حذف الحساب نهائياً")
        expect(final).to_be_disabled()
        self.assertEqual([c for c in calls if c[0] == "delete"], [])
        confirm.get_by_role("checkbox").check()
        final.click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        self.assertEqual(calls[-1], ("delete", {"user_id": "00000000-0000-4000-8000-000000000002"}))
        expect(self.row(page, "gm@test.invalid")).to_have_count(0)
        expect(page.locator("#assign-status")).to_contain_text("حُذف حساب")

    def test_delete_is_hidden_for_self_super_admin_and_reserved_accounts(self):
        page, *_ = self.open()
        for text in ("ليلى", "حساب محل أحاجي", "حساب الفعاليات"):
            dialog = self.editor(page, text)
            expect(dialog.get_by_role("button", name="حذف الحساب")).to_have_count(0)
            dialog.get_by_role("button", name="إغلاق").click()
        dialog = self.editor(page, "مدير ثانٍ")
        expect(dialog.get_by_role("button", name="حذف الحساب")).to_be_visible()

    def test_ordinary_admin_sees_no_delete_option(self):
        page, *_ = self.open(super_admin=False)
        for text in ("gm@test.invalid", "مدير ثانٍ"):
            dialog = self.editor(page, text)
            expect(dialog.get_by_role("button", name="حذف الحساب")).to_have_count(0)
            expect(dialog.get_by_role("checkbox", name="الحساب نشط")).to_be_visible()
            dialog.get_by_role("button", name="إغلاق").click()

    def test_partial_failure_is_reported_and_account_kept_in_view(self):
        page, staff, calls = self.open(delete_status=502)
        self.editor(page, "gm@test.invalid").get_by_role("button", name="حذف الحساب").click()
        confirm = page.get_by_role("dialog", name="حذف الحساب نهائياً")
        confirm.get_by_role("checkbox").check()
        confirm.get_by_role("button", name="حذف الحساب نهائياً").click()
        expect(confirm.get_by_text("تعذّر حذف هوية الدخول")).to_be_visible()
        expect(confirm.get_by_role("button", name="إلغاء")).to_be_enabled()

    def test_reserved_operational_accounts_are_locked_except_activation(self):
        page, staff, calls = self.open()
        expect(self.row(page, "حساب محل أحاجي")).to_contain_text("venue@ahaji.com")
        dialog = self.editor(page, "حساب محل أحاجي")
        expect(dialog.get_by_text("حساب تشغيلي ثابت يُدار من النظام")).to_be_visible()
        expect(dialog.get_by_role("combobox", name="الدور")).to_be_hidden()
        expect(dialog.locator(".staff-room-choices")).to_be_hidden()
        expect(dialog.get_by_role("combobox", name="الحساب التشغيلي")).to_have_count(0)
        dialog.get_by_role("checkbox", name="الحساب نشط").uncheck()
        dialog.get_by_role("button", name="حفظ الصلاحيات").click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        self.assertEqual(calls[-1], ("manage", {"p_user_id": VENUE, "p_role": "game_master",
                                                "p_active": False, "p_room_ids": ["anbar", "saleh"]}))
        expect(self.row(page, "حساب محل أحاجي").get_by_role("button", name="إعادة تعيين كلمة المرور")).to_be_visible()

    def test_add_member_has_no_operational_selector_and_rejects_reserved_names(self):
        page, staff, calls = self.open()
        page.get_by_role("button", name="إضافة عضو", exact=False).click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("combobox", name="الحساب التشغيلي")).to_have_count(0)
        expect(dialog.get_by_text("حساب محل أحاجي")).to_have_count(0)
        expect(dialog.get_by_text("حساب الفعاليات")).to_have_count(0)
        options = dialog.get_by_role("combobox", name="طريقة الدخول").locator("option").all_inner_texts()
        self.assertEqual(options, ["مدير لعبة باسم مستخدم", "دعوة عبر بريد موثّق"])
        for reserved in ("venue", "events@ahaji.com"):
            dialog.get_by_role("textbox", name="اسم المستخدم · ‎@ahaji.com").fill(reserved)
            dialog.get_by_role("button", name="إنشاء الحساب").click()
            expect(dialog.get_by_text("هذا الاسم محجوز لحساب تشغيلي ثابت")).to_be_visible()
        self.assertFalse(any(c[0] == "operator" for c in calls), "reserved names never reach provisioning")

    def test_history_keeps_label_of_deleted_account(self):
        context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.addCleanup(context.close)
        install_auth_mock(context, dashboard=True)
        session = {"id": "11111111-1111-4111-8111-111111111111", "room_id": "anbar", "gm_user_id": None,
                   "status": "ended", "result": "win", "started_at": "2026-10-18T10:00:00Z",
                   "ended_at": "2026-10-18T11:00:00Z", "created_at": "2026-10-18T10:00:00Z",
                   "updated_at": "2026-10-18T11:00:00Z", "remaining_seconds": 0, "revision": 3}
        context.route(f"{API}/rest/v1/game_sessions*", lambda r: r.fulfill(status=200, headers=JSON, body=json.dumps([session])))
        context.route(f"{API}/rest/v1/rpc/admin_deleted_staff", lambda r: r.fulfill(status=200, headers=JSON, body=json.dumps(
            [{"former_user_id": "x", "label": "سارة", "session_ids": [session["id"]], "deleted_at": "2026-10-19T00:00:00Z"}])))
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=history")
        page.get_by_role("checkbox", name="إظهار الجلسات القصيرة والاختبارية").check()
        expect(page.locator(".history-card").first).to_contain_text("سارة · حساب محذوف")


if __name__ == "__main__":
    unittest.main()
