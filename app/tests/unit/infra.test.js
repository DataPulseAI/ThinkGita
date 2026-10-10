// Proves the test harness can reach private helpers in the edge functions and the dashboard.
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("imports framer-sync helpers", async () => {
    const m = await import("../../../supabase/functions/framer-sync/index.ts");
    expect(typeof m.websiteMissing).toBe("function");
    expect(typeof m.title).toBe("function");
  });
  it("imports provision-circle helpers", async () => {
    const m = await import("../../../supabase/functions/provision-circle/index.ts");
    expect(typeof m.endUtc).toBe("function");
  });
  it("imports Admin.jsx helpers", async () => {
    const m = await import("../../src/Admin.jsx");
    expect(typeof m.webState).toBe("function");
  });
});
