"""Run with: python -m unittest discover -s tests -v"""

import functools
import http.server
import pathlib
import re
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


class Phase2BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context()
        install_auth_mock(self.context)
        self.errors = []

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], f"Browser errors: {self.errors}")

    def page(self):
        page = self.context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        return page

    def gm(self, room="anbar", session=None):
        page = self.page()
        suffix = f"&session={session}" if session else ""
        page.goto(f"{self.base}/gm.html?room={room}{suffix}")
        expect(page.locator("#gm-room-name")).not_to_be_empty()
        return page, parse_qs(urlparse(page.url).query)["session"][0]

    def cast(self, room, session):
        page = self.page()
        page.goto(f"{self.base}/cast.html?room={room}&session={session}")
        return page

    def test_room_foundation_and_gm_cast_journey(self):
        home = self.page()
        home.goto(self.base)
        expect(home.locator(".room-card")).to_have_count(3)
        expect(home.locator(".room-card[data-room='anbar'] img")).to_have_attribute("src", "images/prison.jpg")

        gm, session = self.gm()
        with gm.expect_popup() as popup_info:
            gm.locator("#btn-open-cast").click()
        cast = popup_info.value
        cast.on("pageerror", lambda error: self.errors.append(str(error)))
        self.assertEqual(parse_qs(urlparse(cast.url).query)["session"][0], session)
        expect(cast.locator("#cast-idle-name")).to_contain_text("Prison")
        expect(cast.locator("#cast-bg")).to_have_attribute("src", "source/prison/background.jpg")

        gm.locator("#btn-start").click()
        expect(cast.locator("#cast-content")).to_have_class(re.compile(r"\bvisible\b"), timeout=5000)
        expect(gm.locator("#gm-timer-display")).to_have_class("gm-timer-display running")

        gm.locator("#btn-pause").click()
        expect(cast.locator("#cast-timer")).to_have_class("cast-timer paused")
        paused = cast.locator("#cast-timer").inner_text()
        gm.locator("#time-adj-value").fill("2")
        gm.locator("#btn-update-time").click()
        expect(cast.locator("#cast-timer")).not_to_have_text(paused)
        gm.locator("#btn-pause").click()
        expect(cast.locator("#cast-timer")).to_have_class("cast-timer running")

        gm.locator("#hint-input").fill("Look under the table")
        gm.locator("#btn-send-hint").click()
        expect(cast.locator("#cast-hint-text")).to_have_text("Look under the table")
        gm.locator("#btn-show-images").click()
        gm.locator(".gm-media-item").first.click()
        expect(cast.locator("#cast-image-overlay")).to_be_visible()
        expect(cast.locator("#cast-image-overlay-img")).to_have_attribute("src", "source/prison/images/مكان فك الزنزانة.png")

        cast.reload()
        expect(cast.locator("#cast-hint-text")).to_have_text("Look under the table")
        expect(cast.locator("#cast-image-overlay")).to_be_visible()
        gm.reload()
        expect(gm.locator("#gm-timer-display")).to_have_class("gm-timer-display running")
        expect(gm.locator("#gm-current-hint-display")).to_have_text("Look under the table")

        gm.locator("#btn-win").click()
        expect(cast.locator("#cast-result-screen")).to_have_class("cast-result-screen visible win")
        gm.locator("#btn-reset").click()
        expect(cast.locator("#cast-content")).not_to_have_class(re.compile(r"\bvisible\b"))
        expect(cast.locator("#cast-image-overlay")).to_be_hidden()
        expect(cast.locator("#cast-timer")).to_have_text("60:00")

        gm.locator("#btn-start").click()
        gm.locator("#time-adj-value").fill("-60")
        gm.locator("#btn-update-time").click()
        expect(cast.locator("#cast-result-screen")).to_have_class("cast-result-screen visible lose")
        expect(cast.locator("#cast-timer")).to_have_text("00:00")

    def test_isolation_invalid_links_and_reconnect(self):
        gm_a, session_a = self.gm("anbar")
        gm_b, session_b = self.gm("haram")
        gm_same_room, session_same_room = self.gm("anbar")
        self.assertNotEqual(session_a, session_b)
        self.assertNotEqual(session_a, session_same_room)
        cast_a = self.cast("anbar", session_a)
        cast_b = self.cast("haram", session_b)
        cast_same_room = self.cast("anbar", session_same_room)

        gm_a.locator("#hint-input").fill("Only prison")
        gm_a.locator("#btn-send-hint").click()
        expect(cast_a.locator("#cast-hint-text")).to_have_text("Only prison")
        expect(cast_b.locator("#cast-hint-text")).to_have_text("")
        expect(cast_same_room.locator("#cast-hint-text")).to_have_text("")

        # Messages bearing the right channel name but the wrong room are ignored.
        gm_a.evaluate("""(id) => {
          const channel = new BroadcastChannel('ahaji-session-' + id);
          channel.postMessage({ type: 'state', roomId: 'haram', sessionId: id,
            state: { roomId: 'haram', sessionId: id, status: 'paused',
              remainingSeconds: 1, endsAt: null, hintText: 'WRONG ROOM',
              lastUpdatedAt: Date.now() + 100000 } });
          channel.close();
        }""", session_a)
        expect(cast_a.locator("#cast-hint-text")).to_have_text("Only prison")

        wrong_room = self.cast("haram", session_a)
        expect(wrong_room.locator("#cast-invalid-session")).to_contain_text("Invalid session")
        gm_collision, fresh_id = self.gm("haram", session_a)
        self.assertNotEqual(fresh_id, session_a)
        expect(cast_a.locator("#cast-hint-text")).to_have_text("Only prison")

        missing = self.page()
        missing.goto(f"{self.base}/cast.html?room=anbar")
        expect(missing.locator("#cast-invalid-session")).to_contain_text("Missing session")
        invalid = self.cast("anbar", "bad%20id")
        expect(invalid.locator("#cast-invalid-session")).to_contain_text("Invalid session")

        late_id = "late-session-123"
        late_cast = self.cast("saleh", late_id)
        expect(late_cast.locator("#cast-invalid-session")).to_contain_text("Session unavailable")
        late_gm, actual_id = self.gm("saleh", late_id)
        self.assertEqual(actual_id, late_id)
        expect(late_cast.locator("#cast-invalid-session")).to_have_count(0)
        late_gm.locator("#btn-start").click()
        expect(late_cast.locator("#cast-content")).to_have_class(re.compile(r"\bvisible\b"))
        late_cast.locator("#cast-audio-unlock").click()
        late_gm.locator("#time-adj-value").fill("-60")
        late_gm.locator("#btn-update-time").click()
        expect(late_cast.locator("#cast-result-screen")).to_have_class("cast-result-screen visible lose")
        expect(late_cast.locator("#cast-lose-video")).to_have_attribute("src", "source/unclesaleh/loose-video.mp4")

        # With the saved snapshot removed, a newly opened Cast gets a snapshot
        # from the live GM via the explicit reconnect request.
        gm_a.evaluate("(id) => localStorage.removeItem('ahaji-state-' + id)", session_a)
        recovered_cast = self.cast("anbar", session_a)
        expect(recovered_cast.locator("#cast-invalid-session")).to_have_count(0)
        expect(recovered_cast.locator("#cast-hint-text")).to_have_text("Only prison")

        # A separate browser storage context cannot join a local-only session.
        other_context = self.browser.new_context()
        try:
            other_cast = other_context.new_page()
            other_cast.goto(f"{self.base}/cast.html?room=anbar&session={session_a}")
            expect(other_cast.locator("#cast-invalid-session")).to_contain_text("Session unavailable")
        finally:
            other_context.close()

        gm_collision.close()
        gm_same_room.close()
        gm_b.close()

    def test_storage_event_fallback(self):
        gm, session = self.gm("haram")
        cast = self.page()
        # Disable channel delivery in this page to prove that the storage
        # subscription remains functional on its own.
        cast.add_init_script("""window.BroadcastChannel = class {
          addEventListener() {}
          removeEventListener() {}
          postMessage() {}
          close() {}
        };""")
        cast.goto(f"{self.base}/cast.html?room=haram&session={session}")
        expect(cast.locator("#cast-idle-name")).to_contain_text("Pyramid")
        gm.locator("#btn-start").click()
        expect(cast.locator("#cast-content")).to_have_class(re.compile(r"\bvisible\b"))
        gm.locator("#hint-input").fill("Storage fallback")
        gm.locator("#btn-send-hint").click()
        expect(cast.locator("#cast-hint-text")).to_have_text("Storage fallback")


if __name__ == "__main__":
    unittest.main()
