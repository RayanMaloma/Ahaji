"""ربط الغرف and operational accounts (mocked Supabase, real Chromium).

The assignment RPCs are stateful fakes that mirror the SQL contract:
expected-owner checks (40001) and the running-game guard (55006). Database
enforcement itself is covered by supabase/tests/operational_room_assignments.sql.
"""

import copy
import functools
import http.server
import json
import pathlib
import threading
import unittest

from playwright.sync_api import expect, sync_playwright
from auth_fixture import DASHBOARD_STAFF, install_auth_mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://gbhleqizxcmxmutgcjon.supabase.co"
JSON = {"content-type": "application/json", "access-control-allow-origin": "*"}
VENUE = "00000000-0000-4000-8000-0000000000b1"
EVENTS = "00000000-0000-4000-8000-0000000000b2"


def initial_state():
    return {
        "accounts": [
            {"slot": "events", "user_id": EVENTS, "active": True, "login_name": "ahaji_events", "display_name": "حساب الفعاليات"},
            {"slot": "venue", "user_id": VENUE, "active": True, "login_name": "ahaji_venue", "display_name": "حساب محل أحاجي"},
        ],
        "rooms": [
            {"room_id": "anbar", "name": "عنبر 23", "image_ref": "source/prison/background.jpg", "is_active": True, "slot": "venue"},
            {"room_id": "haram", "name": "الهرم", "image_ref": "source/pyramid/background.jpg", "is_active": True, "slot": "venue"},
            {"room_id": "saleh", "name": "العم صالح", "image_ref": "source/unclesaleh/background.jpg", "is_active": True, "slot": "venue"},
            {"room_id": "asrar_alfaw", "name": "أسرار الفاو", "image_ref": "images/pyramid.png", "is_active": True, "slot": "events"},
            {"room_id": "new_room", "name": "غرفة جديدة", "image_ref": "images/unclesaleh.png", "is_active": True, "slot": None},
        ],
    }


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


class RoomAssignmentBrowserTests(unittest.TestCase):
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

    def open(self, viewport=None, busy=(), stale=False):
        context = self.browser.new_context(viewport=viewport or {"width": 1440, "height": 1000})
        self.addCleanup(context.close)
        install_auth_mock(context, dashboard=True)
        state = initial_state()
        calls = []
        requests = []
        context.on("request", lambda r: requests.append((r.method, r.url)))

        def assignments(route):
            route.fulfill(status=200, headers=JSON, body=json.dumps(state))

        def assign(route):
            body = route.request.post_data_json
            calls.append(body)
            room = next(r for r in state["rooms"] if r["room_id"] == body["p_room_id"])
            if stale or (room["slot"] or "") != body["p_expected_slot"]:
                if stale:
                    room["slot"] = "events" if room["slot"] == "venue" else "venue"
                route.fulfill(status=400, headers=JSON, body=json.dumps({"code": "40001", "message": "Room assignment changed"}))
                return
            if room["room_id"] in busy:
                route.fulfill(status=400, headers=JSON, body=json.dumps({"code": "55006", "message": "Room has a game in progress"}))
                return
            room["slot"] = body["p_slot"]
            route.fulfill(status=200, headers=JSON, body=json.dumps({"room_id": room["room_id"], "slot": body["p_slot"]}))

        def slot(route):
            calls.append({"slot": route.request.post_data_json})
            route.fulfill(status=200, headers=JSON, body="null")

        context.route(f"{API}/rest/v1/rpc/admin_room_assignments", assignments)
        context.route(f"{API}/rest/v1/rpc/admin_set_room_assignment", assign)
        context.route(f"{API}/rest/v1/rpc/admin_set_operational_slot", slot)
        page = context.new_page()
        page.goto(self.base + "/admin.html?view=assignments")
        expect(page.get_by_role("heading", level=1)).to_have_text("ربط الغرف")
        expect(page.locator(".ahaji-loader--page")).to_be_hidden()
        return page, state, calls, requests

    def column(self, page, slot):
        return page.locator(f".assign-column-{slot}")

    def card(self, page, name):
        return page.locator(".assign-card").filter(has_text=name)

    def test_navigation_item_sits_directly_below_rooms(self):
        page, *_ = self.open()
        links = page.locator(".admin-nav a").evaluate_all("els => els.map(e => e.dataset.nav)")
        self.assertEqual(links[links.index("rooms") + 1], "assignments")
        expect(page.locator('.admin-nav a[data-nav="assignments"]')).to_have_attribute("aria-current", "page")
        expect(page.locator('.admin-nav a[data-nav="assignments"]')).to_have_text("ربط الغرف")

    def test_two_column_layout_spacing_divider_and_centered_titles(self):
        page, *_ = self.open()
        events, venue = self.column(page, "events"), self.column(page, "venue")
        expect(events.get_by_role("heading", level=2)).to_have_text("حساب الفعاليات")
        expect(venue.get_by_role("heading", level=2)).to_have_text("حساب محل أحاجي")
        eb, vb = events.bounding_box(), venue.bounding_box()
        self.assertGreater(eb["x"], vb["x"], "events column is on the right")
        self.assertAlmostEqual(eb["width"], vb["width"], delta=2, msg="equal column widths")
        for col in (events, venue):
            box, title = col.locator(".assign-grid").bounding_box(), col.get_by_role("heading", level=2).bounding_box()
            self.assertAlmostEqual(title["x"] + title["width"] / 2, box["x"] + box["width"] / 2, delta=3)
            text_align = col.get_by_role("heading", level=2).evaluate("e => getComputedStyle(e).textAlign")
            self.assertEqual(text_align, "center")
        divider = venue.evaluate("e => getComputedStyle(e).borderRightWidth + ' ' + getComputedStyle(e).borderRightColor")
        self.assertTrue(divider.startswith("1px"), divider)
        nearest_events = min(c.bounding_box()["x"] for c in events.locator(".assign-card").all())
        nearest_venue = max(c.bounding_box()["x"] + c.bounding_box()["width"] for c in venue.locator(".assign-card").all())
        self.assertGreaterEqual(nearest_events - nearest_venue, 48, "generous space between the two columns")
        headings = page.locator(".assign-page h2").all_inner_texts()
        self.assertFalse(any(ch.isdigit() for h in headings for ch in h), f"no counts near headings: {headings}")

    def test_cards_show_only_image_name_and_menu(self):
        page, state, *_ = self.open()
        expect(self.column(page, "venue").locator(".assign-card")).to_have_count(3)
        expect(self.column(page, "events").locator(".assign-card")).to_have_count(1)
        card = self.card(page, "عنبر 23")
        self.assertEqual(card.inner_text().strip(), "عنبر 23")
        self.assertIn("source/prison/background.jpg", card.locator("img").get_attribute("src"))
        expect(card.locator(".assign-card-menu i")).to_have_count(3)
        self.assertEqual(card.locator(".assign-card-media img").evaluate("i => getComputedStyle(i).objectFit"), "cover")
        expect(page.get_by_text("اضغط لخيارات الغرفة")).to_have_count(0)
        expect(page.locator(".assign-page").get_by_role("button", name="نقل", exact=False)).to_have_count(0)
        expect(page.get_by_text("السجن")).to_have_count(0)
        expect(page.get_by_text("anbar")).to_have_count(0)

    def test_hover_and_keyboard_open_the_actions_dialog(self):
        page, *_ = self.open()
        card = self.card(page, "الهرم")
        before = card.evaluate("e => getComputedStyle(e).borderColor")
        card.hover()
        page.wait_for_timeout(250)
        self.assertNotEqual(card.evaluate("e => getComputedStyle(e).borderColor"), before)
        page.mouse.move(5, 5)
        page.keyboard.press("Shift")
        card.focus()
        self.assertTrue(card.evaluate("e => e.matches(':focus-visible')"))
        self.assertIn("rgb(245, 200, 0)", card.evaluate("e => getComputedStyle(e).outlineColor"))
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="الهرم")
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        self.assertTrue(card.evaluate("e => document.activeElement === e"), "focus returns to the card")

    def test_dialog_actions_per_account(self):
        page, *_ = self.open()
        self.card(page, "أسرار الفاو").click()
        dialog = page.get_by_role("dialog", name="أسرار الفاو")
        names = dialog.locator(".assign-action").all_inner_texts()
        self.assertEqual(sorted(names[:2]), sorted(["إزالة الغرفة", "نقل إلى حساب محل أحاجي"]))
        self.assertEqual(names[2:], ["إلغاء"])
        dialog.get_by_role("button", name="إلغاء").click()
        self.card(page, "العم صالح").click()
        dialog = page.get_by_role("dialog", name="العم صالح")
        self.assertEqual(sorted(dialog.locator(".assign-action").all_inner_texts()[:2]),
                         sorted(["إزالة الغرفة", "نقل إلى حساب الفعاليات"]))
        expect(dialog.get_by_role("button", name="إغلاق")).to_be_visible()

    def test_remove_unassigns_without_deleting_anything(self):
        page, state, calls, requests = self.open()
        self.card(page, "أسرار الفاو").click()
        dialog = page.get_by_role("dialog", name="أسرار الفاو")
        dialog.get_by_role("button", name="إزالة الغرفة").click()
        expect(dialog.get_by_text("تبقى الغرفة وتلميحاتها ووسائطها وسجل جلساتها")).to_be_visible()
        self.assertEqual(calls, [], "removal needs confirmation")
        dialog.get_by_role("button", name="تأكيد الإزالة").click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        self.assertEqual(calls[-1], {"p_room_id": "asrar_alfaw", "p_slot": None, "p_expected_slot": "events"})
        expect(page.locator(".assign-unassigned .assign-card").filter(has_text="أسرار الفاو")).to_be_visible()
        expect(self.column(page, "events").get_by_text("لا توجد غرف مرتبطة.")).to_be_visible()
        destructive = [(m, u) for m, u in requests if m == "DELETE" or "/storage/v1/" in u and m != "GET"]
        self.assertEqual(destructive, [], "no room or Storage deletion")
        expect(page.locator("#assign-status")).to_have_text("أُزيلت «أسرار الفاو» من حساب الفعاليات.")

    def test_move_transfers_between_accounts_and_back(self):
        page, state, calls, _ = self.open()
        self.card(page, "الهرم").click()
        page.get_by_role("dialog").get_by_role("button", name="نقل إلى حساب الفعاليات").click()
        expect(self.column(page, "events").locator(".assign-card").filter(has_text="الهرم")).to_be_visible()
        expect(self.column(page, "venue").locator(".assign-card").filter(has_text="الهرم")).to_have_count(0)
        self.assertEqual(calls[-1], {"p_room_id": "haram", "p_slot": "events", "p_expected_slot": "venue"})
        self.card(page, "الهرم").click()
        page.get_by_role("dialog").get_by_role("button", name="نقل إلى حساب محل أحاجي").click()
        expect(self.column(page, "venue").locator(".assign-card").filter(has_text="الهرم")).to_be_visible()

    def test_unassigned_new_room_can_be_assigned(self):
        page, state, calls, _ = self.open()
        unassigned = page.locator(".assign-unassigned")
        expect(unassigned.get_by_role("heading", level=2)).to_have_text("الغرف غير المرتبطة")
        expect(unassigned.locator(".assign-card")).to_have_count(1)
        self.card(page, "غرفة جديدة").click()
        dialog = page.get_by_role("dialog", name="غرفة جديدة")
        self.assertEqual(dialog.locator(".assign-action.primary").all_inner_texts(),
                         ["ربط بـ حساب محل أحاجي", "ربط بـ حساب الفعاليات"])
        dialog.get_by_role("button", name="ربط بـ حساب الفعاليات").click()
        expect(self.column(page, "events").locator(".assign-card").filter(has_text="غرفة جديدة")).to_be_visible()
        expect(unassigned.get_by_text("كل الغرف مرتبطة بحساب.")).to_be_visible()

    def test_running_game_and_stale_view_are_refused_clearly(self):
        page, *_ = self.open(busy=("anbar",))
        self.card(page, "عنبر 23").click()
        dialog = page.get_by_role("dialog", name="عنبر 23")
        dialog.get_by_role("button", name="نقل إلى حساب الفعاليات").click()
        expect(dialog.get_by_text("الغرفة قيد اللعب الآن")).to_be_visible()
        expect(self.column(page, "venue").locator(".assign-card").filter(has_text="عنبر 23")).to_be_visible()
        stale, state, *_ = self.open(stale=True)
        self.card(stale, "العم صالح").click()
        stale.get_by_role("dialog").get_by_role("button", name="نقل إلى حساب الفعاليات").click()
        # The server changed underneath: the page reloads the authoritative view.
        expect(stale.get_by_role("dialog")).to_have_count(0)
        expect(self.column(stale, "events").locator(".assign-card").filter(has_text="العم صالح")).to_be_visible()

    def test_mobile_stacks_sections_without_horizontal_scroll(self):
        page, *_ = self.open(viewport={"width": 390, "height": 844})
        events, venue = self.column(page, "events").bounding_box(), self.column(page, "venue").bounding_box()
        self.assertLess(events["y"] + events["height"], venue["y"] + 1, "events section first, stacked")
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 391)
        border_top = self.column(page, "venue").evaluate("e => getComputedStyle(e).borderTopWidth")
        self.assertEqual(border_top, "1px")

    def test_staff_editor_designates_operational_accounts(self):
        page, state, calls, _ = self.open()
        staff = copy.deepcopy(DASHBOARD_STAFF)
        gm = next(s for s in staff if s["role"] == "game_master")
        page.context.route(f"{API}/rest/v1/rpc/admin_staff_directory",
                           lambda route: route.fulfill(status=200, headers=JSON, body=json.dumps(staff)))
        page.context.route(f"{API}/rest/v1/rpc/admin_manage_staff",
                           lambda route: (calls.append({"manage": route.request.post_data_json}),
                                          route.fulfill(status=200, headers=JSON, body="null")))
        page.get_by_role("link", name="فريق العمل").click()
        page.locator(".staff-table tbody tr").filter(has_text=gm["email"]).get_by_role("button", name="إدارة").click()
        dialog = page.get_by_role("dialog")
        rooms = dialog.locator(".staff-room-choices")
        expect(rooms).to_be_visible()
        dialog.get_by_role("combobox", name="الحساب التشغيلي").select_option("venue")
        expect(rooms).to_be_hidden()
        expect(dialog.get_by_text("تُدار غرف هذا الحساب من صفحة «ربط الغرف».")).to_be_visible()
        dialog.get_by_role("combobox", name="الدور").select_option("admin")
        expect(dialog.get_by_role("combobox", name="الحساب التشغيلي")).to_be_hidden()
        dialog.get_by_role("combobox", name="الدور").select_option("game_master")
        dialog.get_by_role("combobox", name="الحساب التشغيلي").select_option("venue")
        dialog.get_by_role("button", name="حفظ الصلاحيات").click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        self.assertEqual(calls[-1], {"slot": {"p_user_id": gm["user_id"], "p_slot": "venue"}})
        self.assertEqual(calls[-2]["manage"]["p_room_ids"], [], "operational rooms are managed in ربط الغرف")


if __name__ == "__main__":
    unittest.main()
