"""Operational account sign-in policy (mocked Supabase, real Chromium).

venue@ahaji.com and events@ahaji.com are login identifiers handled by the
operator-login function; they are not mailboxes. Personal accounts keep
verified-email sign-in, including real @ahaji.com addresses.
"""

import functools
import http.server
import json
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock, session

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://gbhleqizxcmxmutgcjon.supabase.co"
JSON = {"content-type": "application/json", "access-control-allow-origin": "*"}
SECRET = "Shared-Op-Pass-2026"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


class OperationalLoginBrowserTests(unittest.TestCase):
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

    def login_page(self, role="game_master", rooms=None, operators=None, admin_email=None):
        """operators maps login name -> (password, active)."""
        context = self.browser.new_context()
        self.addCleanup(context.close)
        install_auth_mock(context, authenticated=False, role=role, rooms=rooms)
        calls = []
        operators = operators or {}

        def operator(route):
            body = route.request.post_data_json
            calls.append(("operator", body["username"]))
            login = body["username"].lower().removesuffix("@ahaji.com")
            entry = operators.get(login)
            if entry and entry[1] and body["password"] == entry[0]:
                tokens = session()
                route.fulfill(status=200, headers=JSON, body=json.dumps(
                    {k: tokens[k] for k in ("access_token", "refresh_token", "expires_in")}))
            else:
                route.fulfill(status=401, headers=JSON, body=json.dumps({"error": "invalid"}))

        def token(route):
            body = route.request.post_data_json or {}
            calls.append(("email", body.get("email")))
            if admin_email and body.get("email") == admin_email and body.get("password") == SECRET:
                route.fulfill(status=200, headers=JSON, body=json.dumps(session()))
            else:
                route.fulfill(status=400, headers=JSON, body=json.dumps(
                    {"msg": "Invalid login credentials", "error_code": "invalid_credentials"}))

        context.route(f"{API}/functions/v1/operator-login", operator)
        context.route(f"{API}/auth/v1/token*", token)
        page = context.new_page()
        page.goto(self.base + "/login.html")
        return page, calls

    def sign_in(self, page, identifier, password):
        page.get_by_label("البريد الإلكتروني أو اسم المستخدم").fill(identifier)
        page.get_by_label("كلمة المرور").fill(password)
        page.get_by_role("button", name="دخول").click()

    def test_venue_signs_in_with_virtual_email_and_sees_only_its_rooms(self):
        page, calls = self.login_page(rooms=["anbar", "saleh"], operators={"venue": (SECRET, True)})
        self.sign_in(page, "Venue@Ahaji.com", SECRET)
        expect(page).to_have_url(self.base + "/index.html")
        self.assertEqual(calls, [("operator", "venue@ahaji.com")], "never sent to email sign-in")
        expect(page.locator(".room-card")).to_have_count(2)
        names = page.locator(".room-card-name").all_inner_texts()
        self.assertEqual(sorted(names), sorted(["عنبر 23", "العم صالح"]))
        self.assertNotIn("recover", page.url)
        self.assertNotIn("password", page.url)

    def test_events_signs_in_without_a_password_change_step(self):
        page, calls = self.login_page(rooms=["haram"], operators={"events": (SECRET, True)})
        self.sign_in(page, "events@ahaji.com", SECRET)
        expect(page).to_have_url(self.base + "/index.html")
        expect(page.locator(".room-card")).to_have_count(1)
        page.goto(self.base + "/gm.html?room=anbar")
        expect(page).to_have_url(self.base + "/unauthorized.html?reason=room")

    def test_wrong_password_and_deactivated_account_are_refused_uniformly(self):
        page, calls = self.login_page(operators={"venue": (SECRET, True), "events": (SECRET, False)})
        self.sign_in(page, "venue@ahaji.com", "wrong-password")
        expect(page.locator("#login-error")).to_be_visible()
        message = page.locator("#login-error").inner_text()
        self.sign_in(page, "events@ahaji.com", SECRET)
        expect(page.locator("#login-error")).to_have_text(message)
        expect(page).to_have_url(self.base + "/login.html")
        self.assertIn(("operator", "events@ahaji.com"), calls)

    def test_personal_admin_with_real_ahaji_address_still_signs_in(self):
        page, calls = self.login_page(role="admin", admin_email="owner@ahaji.com")
        self.sign_in(page, "owner@ahaji.com", SECRET)
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        self.assertEqual(calls, [("operator", "owner@ahaji.com"), ("email", "owner@ahaji.com")])

    def test_other_email_domains_use_verified_email_sign_in_only(self):
        page, calls = self.login_page(role="admin", admin_email="admin@example.com")
        self.sign_in(page, "admin@example.com", SECRET)
        expect(page).to_have_url(self.base + "/admin.html?view=rooms")
        self.assertEqual(calls, [("email", "admin@example.com")])

    def test_bare_username_never_falls_back_to_email(self):
        page, calls = self.login_page(operators={})
        self.sign_in(page, "venue", "nope")
        expect(page.locator("#login-error")).to_be_visible()
        self.assertEqual(calls, [("operator", "venue")])


if __name__ == "__main__":
    unittest.main()
