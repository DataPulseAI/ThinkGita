// Unit tests (Vitest). Run: npm test
// Edge functions (Deno) and Admin.jsx keep their helpers private, so for tests only the plugin below appends
// `export { ... }` with every top-level name; the source files themselves are not changed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const stub = (f) => fileURLToPath(new URL(`./tests/stubs/${f}`, import.meta.url));
const EXPOSE = [/supabase\/functions\/[^/]+\/[^/]+\.ts$/, /app\/src\/Admin\.jsx$/, /app\/src\/WebsitePage\.jsx$/];

function exposeInternals() {
  return {
    name: "expose-internals",
    enforce: "pre",
    // Deno's npm: imports, mapped to the Node package or a stub.
    resolveId(source) {
      if (source.startsWith("npm:@supabase/supabase-js")) return this.resolve("@supabase/supabase-js", fileURLToPath(import.meta.url), { skipSelf: true });
      if (source.startsWith("npm:framer-api")) return stub("framer-api.js");
      if (source.startsWith("npm:nodemailer")) return stub("nodemailer.js");
      return null;
    },
    transform(code, id) {
      if (!EXPOSE.some((re) => re.test(id))) return null;
      const exported = new Set([...code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gm)].map((m) => m[1]));
      const names = new Set();
      for (const m of code.matchAll(/^(?:async\s+)?function\*?\s+(\w+)|^(?:const|let|class)\s+(\w+)/gm)) {
        const n = m[1] ?? m[2];
        if (n && !exported.has(n)) names.add(n);
      }
      return names.size ? { code: `${code}\nexport { ${[...names].join(", ")} };\n`, map: null } : null;
    },
  };
}

export default defineConfig({
  plugins: [exposeInternals(), react()],
  test: {
    include: ["tests/unit/**/*.test.{js,jsx,ts}"],
    environment: "jsdom", // the dashboard reads window at import; edge function tests work here too
    setupFiles: ["tests/stubs/setup.js"],
    server: { deps: { inline: [/supabase\/functions/] } },
  },
});
