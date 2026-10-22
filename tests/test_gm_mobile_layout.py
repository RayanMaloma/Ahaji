"""GM screens on phones: no horizontal scrolling, readable timer, usable controls (mocked Supabase)."""

import functools
import http.server
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHONES = [(320, 640), (375, 812), (390, 844), (430, 932)]
LAYOUT = """() => {
  const timer = document.querySelector('#gm-timer-display').getBoundingClientRect();
  const controls = [...document.querySelectorAll('.gm-header button, .gm-timer-top-actions button:not([hidden]), .gm-controls button, #btn-send-hint')]
    .map(b => b.getBoundingClientRect()).filter(r => r.width);
  const start = document.querySelector('#btn-start').getBoundingClientRect();
  const hit = document.elementFromPoint(start.left + start.width / 2, start.top + start.height / 2);
  return {
    scroll: document.documentElement.scrollWidth - innerWidth,
    timerFont: parseFloat(getComputedStyle(document.querySelector('#gm-timer-display')).fontSize),
    timerInside: timer.left >= 0 && timer.right <= innerWidth,
    smallestControl: Math.min(...controls.map(r => r.height)),
    startReachable: hit && (hit.id === 'btn-start' || !!hit.closest('#btn-start')),
  };
}"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


class GmMobileLayoutTests(unittest.TestCase):
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

    def page(self, width, height):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(context.close)
        install_auth_mock(context, role="game_master", local_session=False, session_store={})
        return context.new_page()

    def test_room_screen_fits_phone_widths(self):
        for width, height in PHONES:
            with self.subTest(width=width):
                page = self.page(width, height)
                page.goto(self.base + "/gm.html?room=anbar")
                expect(page.locator("#gm-room-name")).to_have_text("عنبر 23")
                layout = page.evaluate(LAYOUT)
                self.assertLessEqual(layout["scroll"], 0, layout)
                self.assertTrue(layout["timerInside"], layout)
                self.assertGreaterEqual(layout["timerFont"], 44, layout)
                self.assertGreaterEqual(layout["smallestControl"], 40, layout)
                self.assertTrue(layout["startReachable"], layout)
                page.locator("#btn-start").click()
                expect(page.locator("#gm-timer-display")).to_have_class("gm-timer-display running")
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth - innerWidth"), 0)

    def test_room_selection_fits_phone_widths(self):
        for width, height in PHONES:
            with self.subTest(width=width):
                page = self.page(width, height)
                page.goto(self.base + "/index.html")
                expect(page.locator(".room-card").first).to_be_visible()
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth - innerWidth"), 0)

    def test_desktop_console_stays_one_screen(self):
        page = self.page(1440, 900)
        page.goto(self.base + "/gm.html?room=anbar")
        expect(page.locator("#gm-room-name")).to_have_text("عنبر 23")
        self.assertEqual(page.evaluate("getComputedStyle(document.body).overflow"), "hidden")
        self.assertEqual(page.evaluate("document.documentElement.scrollHeight"), 900)
        self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('#gm-timer-display')).fontSize"), "72px")


if __name__ == "__main__":
    unittest.main()
