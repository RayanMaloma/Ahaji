"""Branded loader regression (mocked Supabase, real Chromium).

Requests are held open so each loading state can be asserted, then released
to verify the loader leaves as soon as the data arrives.
"""

import functools
import hashlib
import http.server
import pathlib
import threading
import time
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
APPROVED = {
    "ahaji-loader.svg": "f5b876db878bd21cd69aa0b1ed54147314b586721e179b024325b0b2a11d7305",
    "ahaji-loader-reduced.svg": "b2b2e14f9d4a13d45b95d781ecdd9b9fca3b2f104f9917441ea1bf490e8d3b65",
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass


class LoaderBrowserTests(unittest.TestCase):
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

    def context(self, reduced=False, viewport=None, **options):
        context = self.browser.new_context(
            viewport=viewport or {"width": 1440, "height": 900},
            reduced_motion="reduce" if reduced else "no-preference")
        install_auth_mock(context, dashboard=True, **options)
        self.addCleanup(context.close)
        return context

    def hold(self, context, pattern):
        """Hold matching requests until release() is called."""
        held = []
        context.route(pattern, lambda route: held.append(route))

        def release(page):
            while not held:
                page.wait_for_timeout(20)
            context.unroute(pattern)
            for route in held:
                route.fallback()
            return time.monotonic()
        return release

    def test_assets_match_approved_checksums(self):
        for name, digest in APPROVED.items():
            data = (ROOT / "images" / "loader" / name).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), digest, name)

    def test_admin_auth_gate_then_rooms_loader(self):
        context = self.context()
        release_user = self.hold(context, "**/auth/v1/user")
        release_rooms = self.hold(context, "**/rest/v1/rooms*")
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        gate = page.locator("#admin-auth-loading")
        expect(gate).to_be_visible()
        expect(gate).to_have_attribute("role", "status")
        expect(gate).to_contain_text("جارٍ التحقق من صلاحية الإدارة")
        mark = gate.locator("img")
        page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=mark.element_handle())
        self.assertTrue(mark.evaluate("img => img.currentSrc").endswith("/images/loader/ahaji-loader.svg"))
        self.assertEqual(page.locator("#admin-shell").is_visible(), False)
        release_user(page)
        section = page.locator("#admin-content [data-loader]")
        expect(section).to_contain_text("جارٍ تحميل الغرف")
        expect(gate).to_be_hidden()
        released = release_rooms(page)
        expect(page.locator(".room-tile")).to_have_count(3)
        elapsed = time.monotonic() - released
        expect(page.locator("[data-loader]:visible")).to_have_count(0)
        self.assertLess(elapsed, 1.5, "loader must leave as soon as data arrives")
        # The overlay is gone, so the page is interactive.
        page.locator(".room-tile").first.click()
        expect(page.get_by_role("heading", level=1)).to_have_text("تعديل الغرفة")

    def test_staff_history_and_workspace_loaders(self):
        context = self.context()
        release_rooms = self.hold(context, "**/rest/v1/rooms*")
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=staff")
        expect(page.locator("#admin-content [data-loader]")).to_contain_text("جارٍ تحميل فريق العمل")
        release_rooms(page)
        expect(page.get_by_role("heading", level=1)).to_have_text("فريق العمل")

        release_history = self.hold(context, "**/rest/v1/game_sessions*")
        page.get_by_role("link", name="سجل الجلسات").click()
        expect(page.locator("#admin-content [data-loader]")).to_contain_text("جارٍ تحميل سجل الجلسات")
        release_history(page)
        expect(page.get_by_role("combobox", name="التاريخ")).to_be_visible()
        expect(page.locator("#admin-content [data-loader]")).to_have_count(0)

        workspace = self.context().new_page()
        held = self.hold(workspace.context, "**/rest/v1/rooms*")
        workspace.goto(self.base + "/admin.html?view=room&id=anbar")
        expect(workspace.locator("#admin-content [data-loader]")).to_contain_text("جارٍ تحميل مساحة الغرفة")
        held(workspace)
        expect(workspace.get_by_role("heading", level=1)).to_have_text("تعديل الغرفة")

    def test_room_image_skeleton_until_image_loads(self):
        context = self.context()
        release_image = self.hold(context, "**/source/prison/background.jpg*")
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        frame = page.locator(".room-tile-image").filter(has=page.locator("img[src*='prison/background']"))
        expect(frame).to_have_count(1)
        self.assertIn("image-skeleton", frame.get_attribute("class"))
        release_image(page)
        expect(frame.locator("img")).not_to_have_class("is-loading")
        page.wait_for_function("el => !el.classList.contains('image-skeleton')", arg=frame.element_handle())

    def test_reduced_motion_uses_static_fallback(self):
        context = self.context(reduced=True)
        release_user = self.hold(context, "**/auth/v1/user")
        page = context.new_page()
        page.goto(self.base + "/admin.html")
        mark = page.locator("#admin-auth-loading img")
        page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=mark.element_handle())
        self.assertTrue(mark.evaluate("img => img.currentSrc").endswith("/images/loader/ahaji-loader-reduced.svg"))
        self.assertEqual(page.locator("#admin-auth-loading").evaluate(
            "el => getComputedStyle(el).animationName"), "none")
        release_user(page)
        expect(page.locator("#admin-auth-loading")).to_be_hidden()

    def test_svg_animation_plays_only_without_reduced_motion(self):
        for reduced, expected in ((False, True), (True, False)):
            page = self.context(reduced=reduced).new_page()
            page.goto(self.base + "/images/loader/ahaji-loader.svg")
            running = page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length")
            self.assertEqual(running > 0, expected, f"reduced={reduced} running={running}")

    def test_img_animation_follows_operating_system_motion_setting(self):
        # Context emulation does not reach an SVG inside <img>; it follows the
        # OS setting. Force each preference so the result does not depend on
        # the machine running the suite.
        for flag, moving in (("--force-prefers-no-reduced-motion", True),
                             ("--force-prefers-reduced-motion", False)):
            browser = self.playwright.chromium.launch(headless=True, args=[flag])
            try:
                page = browser.new_page(viewport={"width": 360, "height": 320})
                page.route(self.base + "/probe.html", lambda route: route.fulfill(
                    content_type="text/html",
                    body='<body style="margin:0;background:#0d0d0d">'
                         '<img id="l" src="images/loader/ahaji-loader.svg" width="317" height="284"></body>'))
                page.goto(self.base + "/probe.html")
                page.wait_for_function("document.getElementById('l').complete")
                frames = set()
                for _ in range(6):
                    page.wait_for_timeout(400)
                    frames.add(hashlib.sha256(page.locator("#l").screenshot()).hexdigest())
                self.assertEqual(len(frames) > 1, moving, f"{flag}: {len(frames)} distinct frames")
            finally:
                browser.close()

    def test_gm_room_selection_loader_on_mobile(self):
        context = self.context(role="game_master", viewport={"width": 390, "height": 844})
        release_rooms = self.hold(context, "**/rest/v1/rooms*")
        page = context.new_page()
        page.goto(self.base + "/index.html")
        gate = page.locator("#auth-loading")
        expect(gate).to_be_visible()
        expect(gate).to_contain_text("جارٍ التحقق من صلاحية الفريق")
        box = gate.locator(".ahaji-loader__mark").bounding_box()
        self.assertGreaterEqual(box["width"], 90)
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 391)
        release_rooms(page)
        expect(gate).to_be_hidden()
        expect(page.locator("#protected-content")).to_be_visible()


if __name__ == "__main__":
    unittest.main()
