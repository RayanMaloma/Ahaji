"""Frontend network-session contract using independent browser storage contexts.

The Supabase HTTP endpoints are fixture-backed here; SQL authorization is checked
separately against the project. This test does not claim a live two-device run.
"""

import functools
import http.server
import pathlib
import threading
import unittest
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass


class ServerSessionBrowserTests(unittest.TestCase):
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

    def test_gm_cast_network_sync_and_pairing_isolation(self):
        store = {}
        gm_context = self.browser.new_context()
        cast_context = self.browser.new_context()
        self.addCleanup(gm_context.close)
        self.addCleanup(cast_context.close)
        install_auth_mock(gm_context, local_session=False, session_store=store)
        install_auth_mock(cast_context, authenticated=False, local_session=False, session_store=store)

        gm = gm_context.new_page()
        gm.goto(self.base + "/gm.html?room=anbar")
        expect(gm.locator("#gm-room-name")).to_have_text("السجن")
        session_id = parse_qs(urlparse(gm.url).query)["session"][0]
        self.assertIn(session_id, store)
        with gm.expect_popup() as popup_info:
            gm.locator("#btn-open-cast").click()
        popup = popup_info.value
        cast_url = popup.url
        popup.close()
        self.assertIn("&key=", cast_url)

        cast = cast_context.new_page()
        cast.goto(cast_url)
        expect(cast.locator("#cast-idle-name")).to_contain_text("السجن", timeout=8000)
        gm.locator("#btn-start").click()
        expect(cast.locator("#cast-content")).to_have_class("cast-content visible", timeout=8000)
        gm.locator("#hint-input").fill("Network hint")
        gm.locator("#btn-send-hint").click()
        expect(cast.locator("#cast-hint-text")).to_have_text("Network hint", timeout=8000)
        cast.reload()
        expect(cast.locator("#cast-hint-text")).to_have_text("Network hint", timeout=8000)
        gm.locator("#btn-win").click()
        expect(cast.locator("#cast-result-screen")).to_have_class("cast-result-screen visible win", timeout=8000)

        unauthorized = cast_context.new_page()
        unauthorized.goto(cast_url.replace("key=" + "a"*48, "key=" + "b"*48))
        expect(unauthorized.locator("#cast-invalid-session")).to_contain_text("انتهت صلاحية العرض", timeout=8000)

    def test_zero_time_adjustment_reaches_server_before_timeout(self):
        store = {}
        context = self.browser.new_context()
        self.addCleanup(context.close)
        install_auth_mock(context, local_session=False, session_store=store)
        gm = context.new_page()
        gm.goto(self.base + "/gm.html?room=anbar")
        expect(gm.locator("#gm-room-name")).to_have_text("السجن")
        session_id = parse_qs(urlparse(gm.url).query)["session"][0]
        gm.locator("#btn-start").click()
        expect(gm.locator("#btn-pause")).to_be_enabled()
        gm.locator("#time-adj-value").fill("-60")
        gm.locator("#btn-update-time").click()
        expect(gm.locator("#btn-win")).to_be_disabled()
        self.assertEqual(store[session_id]["commands"][:2], ["start", "adjust"])
        self.assertEqual(store[session_id]["state"]["viewMode"], "lose")


if __name__ == "__main__":
    unittest.main()
