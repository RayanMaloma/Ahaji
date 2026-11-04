"""GM room opening, simplified headers, connection feedback, and control heights.

Real Chromium with mocked Supabase and a mocked Realtime socket. Live Supabase
is not exercised.
"""

import functools
import http.server
import json
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTROLS = ["btn-win", "btn-alert", "btn-volume", "btn-reset"]
PHONES = [(320, 640), (375, 812), (390, 844), (430, 932)]
SPLASH = "#auth-loading .ahaji-loader__mark"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


def accept_realtime(context, sockets):
    """Answers Phoenix joins and heartbeats, in either protocol encoding."""
    def on_message(socket, raw):
        message = json.loads(raw)
        as_list = isinstance(message, list)
        join_ref, ref, topic, event, payload = message if as_list else (
            message.get("join_ref"), message.get("ref"), message["topic"], message["event"], message.get("payload"))
        if event == "phx_leave" or event == "access_token":
            return
        response = {}
        if event == "phx_join":
            changes = payload["config"]["postgres_changes"]
            response = {"postgres_changes": [{**change, "id": index + 1} for index, change in enumerate(changes)]}
        reply = {"status": "ok", "response": response}
        socket.send(json.dumps([join_ref, ref, topic, "phx_reply", reply] if as_list else
                               {"join_ref": join_ref, "ref": ref, "topic": topic, "event": "phx_reply", "payload": reply}))

    def on_socket(socket):
        sockets.append(socket)
        socket.on_message(lambda raw: on_message(socket, raw))

    context.route_web_socket("**/realtime/v1/websocket**", on_socket)


class GmConsoleRefinementTests(unittest.TestCase):
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

    def context(self, width=1440, height=900, **options):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(context.close)
        install_auth_mock(context, role="game_master", local_session=False, session_store={}, **options)
        return context

    def open_room_selection(self, context):
        page = context.new_page()
        page.goto(self.base + "/index.html")
        expect(page.locator(".room-card").first).to_be_visible()
        expect(page.locator("#auth-loading")).to_be_hidden()
        return page

    def open_console(self, context):
        page = context.new_page()
        page.goto(self.base + "/gm.html?room=anbar")
        expect(page.locator("#gm-room-name")).to_have_text("عنبر 23")
        expect(page.locator("#auth-loading")).to_be_hidden()
        return page

    def test_room_card_shows_the_logo_loader_and_stays_gated(self):
        context = self.context()
        page = self.open_room_selection(context)
        held = []
        context.route("**/rpc/create_game_session", lambda route: held.append(route))
        page.locator(".room-card[data-room='anbar']").click()
        page.wait_for_url("**/gm.html?room=anbar")
        while not held:
            page.wait_for_timeout(20)
        # Authorization and the session are still pending: nothing protected shows.
        expect(page.locator("#auth-loading")).to_be_visible()
        expect(page.locator("#protected-content")).to_be_hidden()
        expect(page.locator(SPLASH)).to_be_visible()
        expect(page.locator("#auth-loading .ahaji-loader__label")).to_be_visible()
        context.unroute("**/rpc/create_game_session")
        for route in held:
            route.fallback()
        expect(page.locator("#gm-room-name")).to_have_text("عنبر 23")
        expect(page.locator("#auth-loading")).to_be_hidden()
        self.assertRegex(page.url, r"room=anbar&session=[0-9a-f-]{36}$")

    def test_room_access_stays_enforced(self):
        context = self.context(rooms=["anbar"])
        page = self.open_room_selection(context)
        expect(page.locator(".room-card")).to_have_count(1)
        page.goto(self.base + "/gm.html?room=haram")
        expect(page).to_have_url(self.base + "/unauthorized.html?reason=room")

        anonymous = self.browser.new_context()
        self.addCleanup(anonymous.close)
        install_auth_mock(anonymous, authenticated=False, local_session=False, session_store={})
        signed_out = anonymous.new_page()
        signed_out.goto(self.base + "/gm.html?room=anbar")
        expect(signed_out).to_have_url(self.base + "/login.html?next=gm.html%3Froom%3Danbar")

    def test_room_open_failure_shows_the_error(self):
        context = self.context()
        page = self.open_room_selection(context)
        context.route("**/rpc/create_game_session", lambda route: route.fulfill(
            status=400, headers={"content-type": "application/json", "access-control-allow-origin": "*"},
            body='{"message":"Unavailable"}'))
        page.locator(".room-card[data-room='anbar']").click()
        expect(page.locator("#auth-failure")).to_contain_text("تعذّر التحقق من صلاحية الدخول")
        expect(page.locator("#auth-loading")).to_be_hidden()
        expect(page.locator("#protected-content")).to_be_hidden()

    def test_room_selection_follows_the_display_order(self):
        page = self.open_room_selection(self.context())
        self.assertEqual(page.locator(".room-card-name").all_inner_texts(), ["العم صالح", "الهرم", "عنبر 23"])
        boxes = [page.locator(".room-card").nth(index).bounding_box() for index in range(3)]
        self.assertGreater(boxes[0]["x"], boxes[1]["x"])
        self.assertGreater(boxes[1]["x"], boxes[2]["x"])

    def test_logout_only_on_room_selection(self):
        context = self.context()
        page = self.open_room_selection(context)
        page.locator(".room-card[data-room='anbar']").click()
        expect(page.locator("#gm-room-name")).to_have_text("عنبر 23")
        expect(page.locator("[data-logout]")).to_have_count(0)
        expect(page.get_by_text("تسجيل الخروج")).to_have_count(0)
        page.go_back()
        expect(page).to_have_url(self.base + "/index.html")
        page.get_by_role("button", name="تسجيل الخروج").click()
        expect(page).to_have_url(self.base + "/login.html")

    def test_connection_badge_only_shows_a_lost_connection(self):
        sockets = []
        context = self.context()
        accept_realtime(context, sockets)
        page = self.open_console(context)
        badge = page.locator("#gm-connection")
        expect(badge).to_be_hidden()
        page.wait_for_timeout(500)
        expect(badge).to_be_hidden()
        expect(page.get_by_text("متصل", exact=True)).to_have_count(0)
        self.assertEqual(len(sockets), 1)
        sockets[0].close()
        expect(badge).to_be_visible(timeout=10000)
        expect(badge).to_have_text("جارٍ إعادة الاتصال…")
        # The socket reconnects by itself and the channel rejoins.
        expect(badge).to_be_hidden(timeout=30000)
        self.assertGreaterEqual(len(sockets), 2)

    def test_connection_badge_stays_clear_of_the_header(self):
        for width, height in [(1440, 900), (320, 640)]:
            with self.subTest(width=width):
                context = self.context(width, height)
                accept_realtime(context, [])
                page = self.open_console(context)
                badge = page.locator("#gm-connection")
                badge.evaluate("el => { el.hidden = false; }")
                self.assertGreaterEqual(badge.bounding_box()["y"], page.locator(".gm-header").bounding_box()["height"])

    def test_divider_sits_between_logo_and_room_name(self):
        long_name = "غرفة بعنوان طويل جدًا لاختبار الالتفاف في الترويسة"
        for width, height in [(1440, 900), (820, 1100), *PHONES]:
            for name in (None, long_name):
                with self.subTest(width=width, name=name):
                    page = self.open_console(self.context(width, height))
                    if name:
                        page.locator("#gm-room-name").evaluate("(el, text) => { el.textContent = text; }", name)
                    box = page.evaluate("""() => {
                      const logo = document.querySelector('.gm-logo').getBoundingClientRect();
                      const room = document.querySelector('#gm-room-name');
                      const style = getComputedStyle(room);
                      const range = document.createRange();
                      range.selectNodeContents(room);
                      const text = range.getBoundingClientRect();
                      const edge = room.getBoundingClientRect();
                      return {logoLeft: logo.left, logoHeight: logo.height, divider: edge.right,
                        dividerHeight: edge.height, textRight: text.right, textLeft: text.left,
                        startWidth: style.borderRightWidth, endWidth: style.borderLeftWidth,
                        dividerColor: style.borderRightColor,
                        scroll: document.documentElement.scrollWidth - innerWidth};
                    }""")
                    self.assertEqual(box["startWidth"], "1px", box)
                    self.assertEqual(box["endWidth"], "0px", box)
                    self.assertLess(box["divider"], box["logoLeft"], box)
                    self.assertLess(box["textRight"], box["divider"], box)
                    self.assertGreaterEqual(box["dividerHeight"], box["logoHeight"], box)
                    self.assertGreaterEqual(box["textLeft"], 0, box)
                    self.assertLessEqual(box["scroll"], 0, box)

    def test_control_heights_are_equal_and_not_clipped(self):
        # Before this change: 37.2px from padding above 720px, min-height 40px below.
        for width, height, expected in [(1440, 900, 45.2), (1100, 800, 45.2), (820, 1100, 45.2),
                                        (430, 932, 48), (390, 844, 48), (375, 812, 48), (320, 640, 48)]:
            with self.subTest(width=width):
                page = self.open_console(self.context(width, height))
                metrics = page.evaluate("""ids => ids.map(id => {
                  const el = document.getElementById(id);
                  const box = el.getBoundingClientRect();
                  return {height: box.height, left: box.left, right: box.right,
                    clipped: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth};
                })""", CONTROLS)
                for control in metrics:
                    self.assertAlmostEqual(control["height"], expected, delta=0.3, msg=metrics)
                    self.assertFalse(control["clipped"], metrics)
                    self.assertGreaterEqual(control["left"], 0, metrics)
                    self.assertLessEqual(control["right"], width, metrics)
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth - innerWidth"), 0)

    def test_gm_and_cast_still_work_together(self):
        store = {}
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.addCleanup(context.close)
        install_auth_mock(context, role="game_master", local_session=False, session_store=store)
        page = self.open_room_selection(context)
        page.locator(".room-card[data-room='anbar']").click()
        expect(page.locator("#gm-room-name")).to_have_text("عنبر 23")
        with context.expect_page() as opened:
            page.locator("#btn-open-cast").click()
        cast = opened.value
        page.locator("#btn-start").click()
        expect(page.locator("#gm-timer-display")).to_have_class("gm-timer-display running")
        expect(cast.locator("#cast-timer")).not_to_have_text("60:00", timeout=10000)


if __name__ == "__main__":
    unittest.main()
