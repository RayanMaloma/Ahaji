"""Branded loader and initial-boot regression (mocked Supabase, real Chromium).

Requests are held open or aborted in the harness to control timing. A per-frame
probe records how many loaders were visible and whether any visible room card
lacked its image when the page gate lifted. Live Supabase is not exercised.
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
COVER = "**/source/prison/background.jpg*"

# Records, every animation frame: visible loaders, any non-gate loader while
# the gate is up, and the state of visible room images when the gate lifts.
BOOT_PROBE = """
(() => {
  const B = window.__boot = {maxLoaders: 0, otherLoaderDuringBoot: false, seenGate: false,
    revealedAt: null, incompleteAtReveal: null, cardsAtReveal: null};
  const shown = el => el.checkVisibility();
  const inView = el => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  function tick() {
    const gate = document.querySelector('.ahaji-loader--page');
    if (gate) {
      const loaders = [...document.querySelectorAll('[data-loader]')].filter(shown);
      B.maxLoaders = Math.max(B.maxLoaders, loaders.length);
      const up = shown(gate) && !gate.classList.contains('is-leaving');
      if (up) {
        B.seenGate = true;
        if (loaders.some(el => el !== gate)) B.otherLoaderDuringBoot = true;
      } else if (B.seenGate && B.revealedAt === null) {
        B.revealedAt = performance.now();
        const cards = [...document.querySelectorAll('.room-tile-image, .room-card')].filter(inView);
        B.cardsAtReveal = cards.length;
        B.incompleteAtReveal = cards.filter(card => {
          const img = card.querySelector('img');
          return img && !(img.complete && img.naturalWidth > 0);
        }).length;
      }
    }
    if (B.revealedAt === null) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
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
        context.add_init_script(BOOT_PROBE)
        self.addCleanup(context.close)
        return context

    def hold(self, context, pattern):
        """Hold matching requests until the returned release() is called."""
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

    def boot(self, page):
        page.wait_for_function("window.__boot && window.__boot.revealedAt !== null", timeout=15000)
        state = page.evaluate("window.__boot")
        expect(page.locator(".ahaji-loader--page")).to_be_hidden()
        return state

    def test_assets_match_approved_checksums(self):
        for name, digest in APPROVED.items():
            data = (ROOT / "images" / "loader" / name).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), digest, name)

    def test_single_boot_loader_until_authorized_data_and_images_are_ready(self):
        context = self.context()
        requests = []
        context.on("request", lambda request: requests.append(request.url))
        release_user = self.hold(context, "**/auth/v1/user")
        release_rooms = self.hold(context, "**/rest/v1/rooms*")
        release_cover = self.hold(context, COVER)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        gate = page.locator("#admin-auth-loading")
        expect(gate).to_be_visible()
        expect(gate).to_contain_text("جارٍ التحقق من صلاحية الإدارة")
        # Authorization is pending: nothing protected exists and no Admin-only request ran.
        self.assertFalse(page.locator("#admin-shell").is_visible())
        self.assertEqual(page.locator(".room-tile").count(), 0)
        self.assertFalse(any("admin_staff_directory" in url or "admin_settle_sessions" in url
                             for url in requests))
        release_user(page)
        page.wait_for_timeout(300)
        expect(gate).to_be_visible()
        release_rooms(page)
        page.wait_for_timeout(300)
        expect(gate).to_be_visible()  # still waiting for the visible cover image
        release_cover(page)
        state = self.boot(page)
        expect(gate).to_be_hidden()
        self.assertEqual(state["maxLoaders"], 1, state)
        self.assertFalse(state["otherLoaderDuringBoot"], state)
        self.assertGreaterEqual(state["cardsAtReveal"], 3, state)
        self.assertEqual(state["incompleteAtReveal"], 0, state)
        self.assertEqual(page.locator("#admin-content [data-loader]").count(), 0)
        self.assertIsNone(page.locator("#admin-shell").get_attribute("aria-busy"))
        self.assertFalse(page.locator("#admin-shell").evaluate("el => el.inert"))
        page.locator(".room-tile").first.click()
        expect(page.get_by_role("heading", level=1)).to_have_text("تعديل الغرفة")

    def test_failed_cover_falls_back_without_hanging(self):
        context = self.context()
        context.route(COVER, lambda route: route.abort())
        page = context.new_page()
        started = time.monotonic()
        page.goto(self.base + "/admin.html?view=rooms")
        state = self.boot(page)
        self.assertLess(time.monotonic() - started, 2.4, "a broken image must not hold the gate")
        self.assertEqual(state["maxLoaders"], 1, state)
        expect(page.locator(".room-tile-image .mini-thumb-fallback")).to_have_count(1)
        expect(page.locator(".room-tile")).to_have_count(3)

    def test_slow_cover_has_bounded_wait(self):
        context = self.context()
        release_cover = self.hold(context, COVER)
        page = context.new_page()
        started = time.monotonic()
        page.goto(self.base + "/admin.html?view=rooms")
        page.wait_for_timeout(1500)
        expect(page.locator("#admin-auth-loading")).to_be_visible()
        state = self.boot(page)
        waited = time.monotonic() - started
        self.assertGreater(waited, 2.0)
        self.assertLess(waited, 5.0, "the gate must lift after the image budget")
        self.assertEqual(state["incompleteAtReveal"], 1, state)
        slow = page.locator(".room-tile-image").filter(has=page.locator("img[src*='prison/background']"))
        self.assertIn("image-skeleton", slow.get_attribute("class"))
        release_cover(page)
        page.wait_for_function("el => !el.classList.contains('image-skeleton')", arg=slow.element_handle())

    def test_navigation_reuses_data_and_images(self):
        context = self.context()
        images = []
        context.on("request", lambda request: images.append(request.url)
                   if request.resource_type == "image" and "/source/" in request.url else None)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        self.boot(page)
        expect(page.locator(".room-tile")).to_have_count(3)
        rooms_reads = []
        context.on("request", lambda request: rooms_reads.append(request.url)
                   if "/rest/v1/rooms" in request.url else None)
        page.get_by_role("link", name="فريق العمل").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("فريق العمل")
        page.get_by_role("link", name="الغرف", exact=True).click()
        expect(page.locator(".room-tile")).to_have_count(3)
        self.assertTrue(page.locator("#admin-auth-loading").is_hidden())
        self.assertEqual(page.locator("#admin-content [data-loader]").count(), 0)
        self.assertEqual(rooms_reads, [], "cached rooms must be reused")
        # Playwright routing disables the HTTP cache, so image reuse is proven
        # without routing in test_preloaded_images_are_reused_without_refetch.
        expect(page.locator(".room-tile-image.image-skeleton")).to_have_count(0)
        # History is genuinely not loaded yet, so it gets a small scoped loader.
        release_history = self.hold(context, "**/rest/v1/game_sessions*")
        page.get_by_role("link", name="سجل الجلسات").click()
        expect(page.locator("#admin-content [data-loader]")).to_contain_text("جارٍ تحميل سجل الجلسات")
        self.assertTrue(page.locator("#admin-auth-loading").is_hidden())
        release_history(page)
        expect(page.get_by_role("combobox", name="التاريخ")).to_be_visible()
        expect(page.locator("#admin-content [data-loader]")).to_have_count(0)

    def test_preloaded_images_are_reused_without_refetch(self):
        # No request routing here, so the browser cache behaves as for users.
        context = self.browser.new_context()
        self.addCleanup(context.close)
        page = context.new_page()
        fetched = []
        page.on("response", lambda response: fetched.append(response.url)
                if "/source/" in response.url and not response.from_service_worker else None)
        page.goto(self.base + "/login.html")
        result = page.evaluate("""async () => {
          const {preloadImages, waitForImages} = await import('./js/loader.mjs?v=loader-2');
          const url = new URL('source/prison/background.jpg', location.href).href;
          preloadImages([url]);
          const first = document.createElement('img'); first.src = url; document.body.append(first);
          await waitForImages([first], 5000);
          first.remove();
          const again = document.createElement('img'); again.src = url;
          return {completeAtCreation: again.complete && again.naturalWidth > 0};
        }""")
        self.assertTrue(result["completeAtCreation"], "a re-rendered card must reuse the decoded image")
        self.assertEqual(len(fetched), 1, fetched)

    def test_deep_links_boot_once_for_staff_history_and_workspace(self):
        for url, check in (("/admin.html?view=staff", lambda p: expect(p.get_by_role("heading", level=1)).to_have_text("فريق العمل")),
                           ("/admin.html?view=history", lambda p: expect(p.get_by_role("combobox", name="التاريخ")).to_be_visible()),
                           ("/admin.html?view=room&id=anbar", lambda p: expect(p.get_by_role("heading", level=1)).to_have_text("تعديل الغرفة"))):
            page = self.context().new_page()
            page.goto(self.base + url)
            state = self.boot(page)
            self.assertEqual(state["maxLoaders"], 1, (url, state))
            self.assertFalse(state["otherLoaderDuringBoot"], (url, state))
            check(page)

    def test_auth_network_and_data_failures(self):
        anonymous = self.context(authenticated=False).new_page()
        anonymous.goto(self.base + "/admin.html?view=rooms")
        expect(anonymous).to_have_url(self.base + "/login.html?next=admin.html%3Fview%3Drooms")

        gm = self.context(role="game_master").new_page()
        gm.goto(self.base + "/admin.html?view=rooms")
        expect(gm).to_have_url(self.base + "/unauthorized.html?reason=admin")

        context = self.context()
        failing = {"on": True}
        context.route("**/rest/v1/staff_accounts*", lambda route: route.abort()
                      if failing["on"] else route.fallback())
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        # supabase-js retries failed GETs before reporting; the gate stays up meanwhile.
        expect(page.locator("#admin-auth-error")).to_be_visible(timeout=25000)
        expect(page.locator("#admin-auth-loading")).to_be_hidden()
        self.assertFalse(page.locator("#admin-shell").is_visible())
        failing["on"] = False
        page.get_by_role("button", name="إعادة المحاولة").click()
        expect(page.locator(".room-tile")).to_have_count(3)
        expect(page.locator("#admin-auth-loading")).to_be_hidden()

        data = self.context(fail_dashboard_once=True).new_page()
        data.goto(self.base + "/admin.html?view=rooms")
        expect(data.get_by_text("تعذّر تحميل البيانات")).to_be_visible()
        expect(data.locator("#admin-auth-loading")).to_be_hidden()
        data.get_by_role("button", name="إعادة المحاولة").click()
        expect(data.locator(".room-tile")).to_have_count(3)

    def test_mobile_boot_is_centered_and_coherent(self):
        context = self.context(viewport={"width": 390, "height": 844})
        release_rooms = self.hold(context, "**/rest/v1/rooms*")
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=rooms")
        mark = page.locator("#admin-auth-loading .ahaji-loader__mark")
        expect(mark).to_be_visible()
        box = mark.bounding_box()
        self.assertAlmostEqual(box["x"] + box["width"] / 2, 195, delta=2)
        self.assertGreaterEqual(box["width"], 90)
        release_rooms(page)
        state = self.boot(page)
        self.assertEqual(state["maxLoaders"], 1, state)
        self.assertEqual(state["incompleteAtReveal"], 0, state)
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 391)

    def test_gm_room_selection_reveals_with_images(self):
        context = self.context(role="game_master", viewport={"width": 390, "height": 844})
        release_rooms = self.hold(context, "**/rest/v1/rooms*")
        page = context.new_page()
        page.goto(self.base + "/index.html")
        gate = page.locator("#auth-loading")
        expect(gate).to_contain_text("جارٍ التحقق من صلاحية الفريق")
        release_rooms(page)
        state = self.boot(page)
        self.assertEqual(state["maxLoaders"], 1, state)
        self.assertEqual(state["incompleteAtReveal"], 0, state)
        expect(page.locator("#protected-content")).to_be_visible()

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
        self.boot(page)
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


if __name__ == "__main__":
    unittest.main()
