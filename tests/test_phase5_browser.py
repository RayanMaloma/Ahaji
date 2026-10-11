"""Phase 5 browser checks with a network-scoped Supabase fixture."""

import functools
import http.server
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock, session


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass


class Phase5BrowserTests(unittest.TestCase):
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

    def context(self, **options):
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        install_auth_mock(context, dashboard=True, **options)
        self.addCleanup(context.close)
        return context

    def test_rooms_details_and_history_in_rtl(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html")
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        self.assertEqual(page.locator("html").get_attribute("dir"), "rtl")
        expect(page.locator('[data-nav="rooms"]')).to_have_attribute("aria-current", "page")
        expect(page.locator("#admin-breadcrumbs")).to_have_text("الغرف")
        self.assertEqual(page.title(), "الغرف · أحاجي")
        expect(page.locator(".page-heading, .filterbar, .filter-count")).to_have_count(0)
        expect(page.locator(".admin-workspace-label")).to_have_count(0)
        expect(page.locator("#sidebar-avatar")).to_have_text("ل")
        expect(page.locator("#topbar-avatar")).to_have_text("ل")
        self.assertEqual(page.locator("body").evaluate("el => getComputedStyle(el).direction"), "rtl")
        self.assertEqual(page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor"), "rgb(13, 13, 13)")
        expect(page.locator(".room-tile")).to_have_count(3)
        expect(page.locator(".room-tile").first.locator(".room-metric-tag")).to_have_text(
            ["تلميحان", "1 صورة", "0 فيديوهات", "3 أصوات"])
        expect(page.locator(".room-tile").nth(1).locator(".room-metric-tag")).to_have_text(
            ["1 تلميح", "صورتان", "0 فيديوهات", "1 صوت"])
        expect(page.locator(".room-tile").nth(2).locator(".room-metric-tag")).to_have_text(
            ["0 تلميحات", "1 صورة", "1 فيديو", "1 صوت"])
        self.assertNotIn("anbar", page.locator(".room-tile").first.inner_text())
        page.locator(".room-tile").first.click()
        expect(page).to_have_url(self.base + "/admin.html?view=room&id=anbar")
        expect(page.locator("#admin-breadcrumbs")).to_have_text("السجن")
        self.assertEqual(page.title(), "السجن · أحاجي")
        expect(page.get_by_role("link", name="جميع الغرف")).to_be_visible()
        self.assertIn("→", page.get_by_role("link", name="جميع الغرف").inner_text())
        expect(page.locator(".room-hero-image img")).to_have_css("display", "block")
        page.wait_for_function("() => document.querySelector('.room-hero-image img')?.naturalWidth > 0")
        self.assertLess(page.locator(".room-hero-image img").evaluate("el => Math.abs(el.getBoundingClientRect().bottom - el.parentElement.getBoundingClientRect().bottom)"), 1)
        expect(page.locator(".room-hero .room-metric-tag")).to_have_text(
            ["تلميحان", "1 صورة", "0 فيديوهات", "3 أصوات"])
        self.assertNotIn("anbar", page.locator(".room-hero").inner_text())
        expect(page.locator(".detail-list li")).to_have_count(6)
        expect(page.get_by_text("Look behind the door")).to_be_visible()
        expect(page.get_by_text("Door clue")).to_be_visible()
        page.reload()
        expect(page.get_by_text("Look behind the door")).to_be_visible()
        page.go_back()
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        page.goto(self.base + "/admin.html?view=overview")
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")

    def test_staff_account_and_logout(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=staff")
        expect(page.locator("#admin-breadcrumbs")).to_have_text("فريق العمل")
        self.assertEqual(page.title(), "فريق العمل · أحاجي")
        expect(page.locator(".page-heading")).to_have_count(0)
        expect(page.locator(".staff-table tbody tr")).to_have_count(2)
        expect(page.get_by_text("gm@test.invalid")).to_be_visible()
        expect(page.get_by_text("جميع الغرف")).to_be_visible()
        page.locator('[data-nav="account"]').click()
        expect(page.locator("#admin-breadcrumbs")).to_have_text("حسابي")
        self.assertEqual(page.title(), "حسابي · أحاجي")
        expect(page.locator(".page-heading")).to_have_count(0)
        expect(page.get_by_text("staff@test.invalid").last).to_be_visible()
        expect(page.locator(".account-avatar")).to_have_text("ل")
        page.locator("#admin-new-email").fill("new@test.invalid")
        page.locator("#admin-email-form button").click()
        expect(page.locator(".form-message")).to_contain_text("رابط التوثيق")
        page.locator("#admin-logout").click()
        expect(page).to_have_url(self.base + "/login.html")

    def test_account_rechecks_identity_on_navigation_refresh_and_direct_url(self):
        user = session()["user"]
        context = self.context(authenticated=True, user_override=user)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=account")
        expect(page.locator(".account-profile-identity strong")).to_have_text("ليلى")
        expect(page.locator(".account-field strong[dir=\"ltr\"]")).to_have_text("staff@test.invalid")
        user["email"] = "updated@test.invalid"
        user["user_metadata"]["display_name"] = "سارة"
        page.locator('[data-nav="staff"]').click()
        expect(page.locator("#admin-breadcrumbs")).to_have_text("فريق العمل")
        page.locator('[data-nav="account"]').click()
        expect(page.locator(".account-profile-identity strong")).to_have_text("سارة")
        expect(page.locator(".account-field strong[dir=\"ltr\"]")).to_have_text("updated@test.invalid")
        expect(page.locator("#sidebar-name")).to_have_text("سارة")
        page.reload()
        expect(page.locator(".account-profile-identity strong")).to_have_text("سارة")
        page.goto(self.base + "/admin.html?view=account")
        expect(page.locator(".account-field strong[dir=\"ltr\"]")).to_have_text("updated@test.invalid")
        user["email"] = "final@test.invalid"
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator(".account-field strong[dir=\"ltr\"]")).to_have_text("final@test.invalid")

    def test_unauthenticated_and_gm_direct_access_denied(self):
        anonymous = self.context(authenticated=False)
        anon_page = anonymous.new_page()
        anon_page.goto(self.base + "/admin.html?view=staff")
        expect(anon_page).to_have_url(self.base + "/login.html?next=admin.html%3Fview%3Dstaff")
        gm = self.context(role="game_master", authenticated=True)
        gm_page = gm.new_page()
        requests = []
        gm_page.on("request", lambda req: requests.append(req.url))
        gm_page.goto(self.base + "/admin.html?view=staff")
        expect(gm_page).to_have_url(self.base + "/unauthorized.html?reason=admin")
        self.assertFalse(any("admin_staff_directory" in url for url in requests))

    def test_error_retry_and_mobile_navigation(self):
        context = self.context(authenticated=True, fail_dashboard_once=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        expect(page.get_by_text("تعذّر تحميل البيانات")).to_be_visible()
        page.get_by_role("button", name="إعادة المحاولة").click()
        expect(page.locator(".room-tile")).to_have_count(3)
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#admin-menu-button").click()
        expect(page.locator("#admin-sidebar")).to_have_class("admin-sidebar open")
        self.assertGreaterEqual(page.locator("#admin-sidebar").bounding_box()["x"], 0)
        page.locator('[data-nav="rooms"]').click()
        expect(page.locator("#admin-sidebar")).to_have_class("admin-sidebar")
        expect(page.locator(".room-tile")).to_have_count(3)
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)

    def test_sidebar_brand_and_navigation_states(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        expect(page.locator(".room-tile")).to_have_count(3)
        brand = page.locator(".admin-brand")
        logo = brand.locator("img")
        expect(logo).to_have_attribute("src", "images/ahajilogo.svg")
        expect(brand.locator("span")).to_have_text("لوحة الإدارة")
        self.assertLess(abs(logo.bounding_box()["x"] + logo.bounding_box()["width"] / 2 -
                            brand.bounding_box()["x"] - brand.bounding_box()["width"] / 2), 2)
        rooms = page.locator('[data-nav="rooms"]')
        staff = page.locator('[data-nav="staff"]')
        expect(rooms).to_have_css("background-color", "rgb(245, 200, 0)")
        rooms.hover()
        expect(rooms).to_have_css("background-color", "rgb(255, 225, 91)")
        expect(rooms).to_have_css("color", "rgb(17, 17, 17)")
        staff.hover()
        expect(staff).to_have_css("background-color", "rgb(41, 41, 41)")
        expect(rooms).to_have_css("background-color", "rgb(245, 200, 0)")
        staff.focus()
        expect(staff).to_have_css("outline-color", "rgb(255, 225, 91)")
        logout = page.locator("#admin-logout")
        expect(logout).to_have_css("color", "rgb(255, 170, 167)")
        logout.focus()
        expect(logout).to_have_css("outline-color", "rgb(255, 170, 167)")
        logout.hover()
        expect(logout).to_have_css("background-color", "rgb(113, 48, 45)")
        staff.click()
        expect(staff).to_have_attribute("aria-current", "page")
        expect(staff).to_have_css("background-color", "rgb(255, 225, 91)")

    def test_all_existing_room_images_load_in_browser(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        expect(page.locator(".room-tile")).to_have_count(3)
        paths = [
            "images/prison.jpg", "images/pyramid.png", "images/unclesaleh.png",
            "source/prison/background.jpg", "source/pyramid/background.jpg",
            "source/unclesaleh/background.jpg",
        ]
        loaded = page.evaluate("""async paths => {
            const results = [];
            for (const path of paths) {
                results.push(await new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
                    img.onerror = () => resolve(false);
                    img.src = '/' + path;
                }));
            }
            return results;
        }""", paths)
        self.assertEqual(loaded, [True] * len(paths))

    def test_room_staff_and_account_layouts_at_desktop_tablet_mobile(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        for width, height in [(1440, 900), (820, 1024), (390, 844)]:
            page.set_viewport_size({"width": width, "height": height})
            for view, title in [("rooms", "الغرف"), ("staff", "فريق العمل"), ("account", "حسابي")]:
                page.goto(self.base + f"/admin.html?view={view}")
                expect(page.locator("#admin-breadcrumbs")).to_have_text(title)
                self.assertEqual(page.title(), f"{title} · أحاجي")
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), width + 1)
                if view == "rooms":
                    expect(page.locator(".room-tile")).to_have_count(3)
                elif view == "account":
                    expect(page.locator(".account-profile-identity strong")).to_have_text("ليلى")
                    expect(page.locator("#admin-new-email")).to_be_visible()


if __name__ == "__main__":
    unittest.main()
