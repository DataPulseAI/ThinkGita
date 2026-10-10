// Shared test data. Made-up people, example.org addresses only.
import { vi } from "vitest";

// Freeze "now" (Date only, so promises and timers behave normally unless a test fakes them too).
export function freeze(iso) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

export const person = (over = {}) => ({
  id: "fac-1", name: "Asha Example", initiated_name: null, email: "asha@example.org", photo_url: "https://img.example.org/asha.jpg", ...over,
});

// A live circle that has everything the website needs.
export const readyCircle = (over = {}) => ({
  id: "circle-1", name: "Gita Circles | Asha Example | Wednesday 19:30 (UK)", name_auto: true, status: "live", website_visible: true,
  weekday: 3, start_time: "19:30:00", duration_min: 60, timezone: "Europe/London", language: "English", circle_type: "Gita Circle",
  website_order: 2, whatsapp_group_link: "https://chat.whatsapp.com/ABC123", starts_on: "2026-09-02", preferred_start: null,
  website_name: null, website_photo_url: null, facilitator: person(), cofacilitators: [], framer_has: {}, framer_created: false,
  framer_item_id: null, framer_photo_src: null, framer_rev: 1, framer_dirty: true, is_demo: false, licence: { is_mock: false },
  ...over,
});
