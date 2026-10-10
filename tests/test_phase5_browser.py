"""Phase 5 browser checks with a network-scoped Supabase fixture."""

import functools
import http.server
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
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

    def test_overview_rooms_details_and_history(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=overview")
        expect(page.locator(".metric-value")).to_have_text(["2", "3", "2", "1"])
        expect(page.get_by_text("Prison").first).to_be_visible()
        expect(page.locator(".content-grid .panel").last.locator(".stack-row-main small").first).to_have_text("All rooms")
        page.locator('[data-nav="rooms"]').click()
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        expect(page.locator(".room-tile")).to_have_count(2)
        page.get_by_label("Filter room status").select_option("inactive")
        expect(page.locator(".room-tile")).to_have_count(1)
        expect(page.locator(".room-tile h2")).to_have_text("Pyramid")
        page.get_by_label("Filter room status").select_option("all")
        page.get_by_label("Search rooms").fill("prison")
        expect(page.locator(".room-tile")).to_have_count(1)
        page.locator(".room-tile").click()
        expect(page).to_have_url(self.base + "/admin.html?view=room&id=anbar")
        expect(page.locator(".detail-list li")).to_have_count(3)
        expect(page.get_by_text("Look behind the door")).to_be_visible()
        expect(page.get_by_text("Door clue")).to_be_visible()
        page.reload()
        expect(page.get_by_text("Look behind the door")).to_be_visible()
        page.go_back()
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")

    def test_staff_account_and_logout(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=staff")
        expect(page.locator(".staff-table tbody tr")).to_have_count(2)
        expect(page.get_by_text("gm@test.invalid")).to_be_visible()
        expect(page.get_by_text("All rooms")).to_be_visible()
        page.locator('[data-nav="account"]').click()
        expect(page.get_by_text("staff@test.invalid").last).to_be_visible()
        page.locator("#admin-new-email").fill("new@test.invalid")
        page.locator("#admin-email-form button").click()
        expect(page.locator(".form-message")).to_contain_text("confirmation link")
        page.locator("#admin-logout").click()
        expect(page).to_have_url(self.base + "/login.html")

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
        page.goto(self.base + "/admin.html?view=overview")
        expect(page.get_by_text("Could not load the dashboard")).to_be_visible()
        page.get_by_role("button", name="Try again").click()
        expect(page.locator(".metric-value")).to_have_text(["2", "3", "2", "1"])
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#admin-menu-button").click()
        expect(page.locator("#admin-sidebar")).to_have_class("admin-sidebar open")
        page.locator('[data-nav="rooms"]').click()
        expect(page.locator("#admin-sidebar")).to_have_class("admin-sidebar")
        expect(page.locator(".room-tile")).to_have_count(2)


if __name__ == "__main__":
    unittest.main()
