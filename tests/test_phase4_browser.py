"""Run with: python -m unittest discover -s tests -v"""

import functools
import http.server
import json
import pathlib
import secrets
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock, session


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass


class Phase4BrowserTests(unittest.TestCase):
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

    def context(self, role="admin", rooms=None, authenticated=False):
        context = self.browser.new_context()
        install_auth_mock(context, role=role, rooms=rooms, authenticated=authenticated)
        self.addCleanup(context.close)
        return context

    def test_login_error_success_refresh_logout(self):
        context = self.context()
        page = context.new_page()
        page.goto(self.base + "/login.html")
        self.assertEqual(page.locator("html").get_attribute("dir"), "rtl")
        page.locator("#email").fill("wrong@test.invalid")
        page.locator("#password").fill(secrets.token_urlsafe(18))
        page.locator("#login-submit").click()
        expect(page.locator("#login-error")).to_be_visible()
        expect(page).to_have_url(self.base + "/login.html")

        page.locator("#email").fill("staff@test.invalid")
        page.locator("#login-submit").click()
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        expect(page.locator(".room-tile")).to_have_count(3)
        page.reload()
        expect(page.locator(".room-tile")).to_have_count(3)
        page.locator("#admin-logout").click()
        expect(page).to_have_url(self.base + "/login.html")
        page.goto(self.base + "/gm.html?room=anbar")
        expect(page).to_have_url(self.base + "/login.html?next=gm.html%3Froom%3Danbar")

    def test_role_routing_and_unauthorized(self):
        gm_context = self.context(role="game_master", rooms=["anbar"], authenticated=True)
        gm = gm_context.new_page()
        gm.goto(self.base + "/index.html")
        expect(gm.locator(".room-card")).to_have_count(1)
        expect(gm.locator("#auth-role")).to_have_text("مدير لعبة")
        gm.goto(self.base + "/gm.html?room=haram")
        expect(gm).to_have_url(self.base + "/unauthorized.html?reason=room")

        no_role_context = self.context(role=None, authenticated=True)
        no_role = no_role_context.new_page()
        no_role.goto(self.base + "/staff.html")
        expect(no_role).to_have_url(self.base + "/unauthorized.html")
        expect(no_role.locator("#denial-message")).to_contain_text("لا توجد صلاحية نشطة")

    def test_recovery_request_and_expired_setup_link(self):
        context = self.context()
        page = context.new_page()
        page.goto(self.base + "/recover.html")
        page.locator("#email").fill("staff@test.invalid")
        page.locator("#request-submit").click()
        expect(page.locator("#recovery-message")).to_contain_text("رسالة الاستعادة")
        page.goto(self.base + "/recover.html?setup=1")
        expect(page.locator("#recovery-message")).to_contain_text("انتهت صلاحية الرابط")
        expect(page.locator("#update-form")).to_be_hidden()

    def test_staff_home_and_email_change_request(self):
        context = self.context(authenticated=True)
        page = context.new_page()
        page.goto(self.base + "/staff.html")
        expect(page.locator("#auth-role")).to_have_text("مدير")
        self.assertEqual(page.locator("html").get_attribute("dir"), "rtl")
        expect(page.locator("#staff-rooms li").first).to_contain_text("عنبر 23")
        expect(page.locator("#staff-rooms li")).to_have_count(3)
        page.locator("#new-email").fill("new-staff@test.invalid")
        page.locator("#change-email-form button").click()
        expect(page.locator("#change-email-message")).to_contain_text("رابط التوثيق")

    def test_operator_username_login_uses_trusted_endpoint(self):
        context=self.context(role="game_master",rooms=["anbar"])
        calls=[]
        def operator_login(route):
            calls.append(route.request.post_data_json)
            credential=session()
            route.fulfill(status=200,headers={"content-type":"application/json",
                "access-control-allow-origin":"*"},body=json.dumps({
                "access_token":credential["access_token"],
                "refresh_token":credential["refresh_token"],
                "expires_in":credential["expires_in"]}))
        context.route("https://gbhleqizxcmxmutgcjon.supabase.co/functions/v1/operator-login",operator_login)
        page=context.new_page()
        page.goto(self.base+"/login.html")
        page.locator("#email").fill("qaoperator@ahaji.com")
        page.locator("#password").fill("fixture-password")
        page.locator("#login-submit").click()
        expect(page).to_have_url(self.base+"/index.html")
        expect(page.locator(".room-card")).to_have_count(1)
        self.assertEqual(calls,[{"username":"qaoperator@ahaji.com","password":"fixture-password"}])


if __name__ == "__main__":
    unittest.main()
