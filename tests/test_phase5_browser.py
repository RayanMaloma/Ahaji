"""Admin browser regression for the current refinement UI (mocked Supabase)."""

import functools
import http.server
import pathlib
import re
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock, session

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHOT_DIR = ROOT / "backups" / "refinement-qa"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass


class Phase5BrowserTests(unittest.TestCase):
    TITLES = {"rooms": "الغرف", "staff": "فريق العمل", "account": "حسابـــي",
              "history": "سجل الجلسات"}

    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        SHOT_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def context(self, **options):
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        install_auth_mock(context, dashboard=True, **options)
        self.addCleanup(context.close)
        return context

    def test_rooms_workspace_and_history_in_rtl(self):
        page = self.context(authenticated=True).new_page()
        page.goto(self.base + "/admin.html")
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        expect(page.get_by_role("heading", level=1)).to_have_text("الغرف")
        self.assertEqual(page.locator("html").get_attribute("dir"), "rtl")
        self.assertEqual(page.locator("#admin-topbar, #topbar-avatar").count(), 0)
        expect(page.get_by_role("button", name="إضافة غرفة", exact=False)).to_have_count(2)
        expect(page.locator(".room-tile")).to_have_count(3)
        page.locator(".room-tile").first.click()
        expect(page).to_have_url(re.compile(r"view=room&id=anbar"))
        expect(page.get_by_role("heading", level=1)).to_have_text("تعديل الغرفة")
        for tab in ("الإعدادات العامة", "التلميحات", "الصور", "المقاطع", "الأصوات"):
            expect(page.get_by_role("link", name=tab)).to_be_visible()
        expect(page.get_by_role("switch", name="حالة الغرفة")).to_be_checked()
        expect(page.locator("iframe[src*='cast-preview']")).to_be_visible()
        page.get_by_role("link", name="التلميحات").click()
        expect(page.get_by_text("Look behind the door")).to_be_visible()
        page.get_by_role("link", name="الصور").click()
        expect(page.get_by_text("Door clue")).to_be_visible()
        page.get_by_role("link", name="الأصوات").click()
        expect(page.get_by_text("Sound cue")).to_be_visible()
        page.reload()
        expect(page.get_by_text("Sound cue")).to_be_visible()
        page.get_by_role("link", name="سجل الجلسات").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("سجل الجلسات")
        expect(page.get_by_role("combobox", name="التاريخ")).to_be_visible()
        expect(page.get_by_role("checkbox", name="إظهار الجلسات القصيرة والاختبارية")).to_be_visible()
        page.goto(self.base + "/admin.html?view=overview")
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")

    def test_staff_account_and_logout(self):
        page = self.context(authenticated=True).new_page()
        page.goto(self.base + "/admin.html?view=staff")
        expect(page.get_by_role("heading", level=1)).to_have_text("فريق العمل")
        expect(page.locator(".staff-table tbody tr")).to_have_count(2)
        expect(page.get_by_text("gm@test.invalid")).to_be_visible()
        page.get_by_role("link", name="حسابي").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("حسابـــي")
        expect(page.get_by_role("textbox", name="الاسم الظاهر")).to_have_value("ليلى")
        expect(page.get_by_role("button", name="حفظ الملف الشخصي")).to_be_visible()
        expect(page.get_by_role("button", name="اختيار صورة")).to_be_visible()
        page.locator("#admin-new-email").fill("new@test.invalid")
        page.locator("#admin-email-form button").click()
        expect(page.locator(".form-message")).to_contain_text("رابط التوثيق")
        page.locator("#admin-logout").click()
        expect(page).to_have_url(self.base + "/login.html")

    def test_account_identity_refresh_and_error_independence(self):
        user = session()["user"]
        page = self.context(authenticated=True, user_override=user, fail_dashboard=True).new_page()
        page.goto(self.base + "/admin.html?view=account")
        expect(page.locator(".account-profile-identity strong")).to_have_text("ليلى")
        expect(page.locator("#sidebar-name")).to_have_text("ليلى")
        user["email"] = "updated@test.invalid"
        page.reload()
        expect(page.locator(".account-field strong[dir='ltr']")).to_have_text("updated@test.invalid")
        expect(page.get_by_role("textbox", name="الاسم الظاهر")).to_have_value("ليلى")
        page.get_by_role("link", name="الغرف", exact=True).click()
        expect(page.get_by_text("تعذّر تحميل البيانات")).to_be_visible()
        page.get_by_role("link", name="حسابي").click()
        expect(page.get_by_role("textbox", name="الاسم الظاهر")).to_have_value("ليلى")

    def test_protected_routes_retry_and_mobile_navigation(self):
        anonymous = self.context(authenticated=False).new_page()
        anonymous.goto(self.base + "/admin.html?view=staff")
        expect(anonymous).to_have_url(self.base + "/login.html?next=admin.html%3Fview%3Dstaff")
        gm = self.context(role="game_master", authenticated=True).new_page()
        requests = []
        gm.on("request", lambda request: requests.append(request.url))
        gm.goto(self.base + "/admin.html?view=staff")
        expect(gm).to_have_url(self.base + "/unauthorized.html?reason=admin")
        self.assertFalse(any("admin_staff_directory" in url for url in requests))
        page = self.context(authenticated=True, fail_dashboard_once=True).new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        expect(page.get_by_text("تعذّر تحميل البيانات")).to_be_visible()
        page.get_by_role("button", name="إعادة المحاولة").click()
        expect(page.locator(".room-tile")).to_have_count(3)
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#admin-menu-button").click()
        expect(page.locator("#admin-sidebar")).to_have_class("admin-sidebar open")
        page.locator('[data-nav="rooms"]').click()
        expect(page.locator("#admin-sidebar")).to_have_class("admin-sidebar")
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 391)

    def test_responsive_layout_fonts_and_original_assets(self):
        page = self.context(authenticated=True).new_page()
        for width, height in ((1440, 900), (820, 1024), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            for view in ("rooms", "staff", "account", "history"):
                page.goto(self.base + f"/admin.html?view={view}")
                expect(page.get_by_role("heading", level=1)).to_have_text(self.TITLES[view])
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), width + 1,
                                     f"{view} overflowed at {width}px")
                if view in ("rooms", "account", "history"):
                    page.screenshot(path=str(SHOT_DIR / f"{view}-{width}.png"), full_page=True)
            page.goto(self.base + "/admin.html?view=room&id=anbar")
            expect(page.get_by_role("heading", level=1)).to_have_text("تعديل الغرفة")
            self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), width + 1)
            page.screenshot(path=str(SHOT_DIR / f"room-{width}.png"), full_page=True)
        page.goto(self.base + "/admin.html?view=rooms")
        font = page.evaluate("""async () => {
            await document.fonts.ready;
            return getComputedStyle(document.body).fontFamily;
        }""")
        self.assertIn("Thmanyah Serif Display", font)
        for path in ("images/prison.jpg", "images/pyramid.png", "images/unclesaleh.png",
                     "source/prison/background.jpg", "source/pyramid/background.jpg",
                     "source/unclesaleh/background.jpg"):
            self.assertTrue((ROOT / path).exists(), path)


if __name__ == "__main__":
    unittest.main()
