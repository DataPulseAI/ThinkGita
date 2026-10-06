import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const hhmm = (t) => (t ? t.slice(0, 5) : "");
export const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const endTime = (t, dur) => {
  const m = toMin(t) + dur;
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Calls the admin edge function with the signed-in user's token.
export async function adminAction(action, circle_id) {
  const { data, error } = await supabase.functions.invoke("provision-circle", { body: { action, circle_id } });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context.json();
      msg = body.error ?? msg;
    } catch (_) { /* keep generic message */ }
    throw new Error(msg);
  }
  return data;
}

export const STATUS_LABEL = {
  pending: "Pending approval",
  conflict: "No licence free",
  approved: "Approved",
  live: "Live",
  paused: "Paused",
  ended: "Ended",
  rejected: "Rejected",
};
