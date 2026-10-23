import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works at https://<org>.github.io/<repo>/
// Demo build (npm run build:demo): made-up data answered in the browser by src/demo/install.js, and a made-up Supabase
// address so nothing can ever reach the real project. DEMO_BASE sets where it will be served from (the showcase on
// aiforcompanies.co.uk needs absolute paths: scripts/publish-showcase.mjs sets it).
const DEMO = {
  "import.meta.env.VITE_DEMO": JSON.stringify("1"),
  "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://thinkgita-demo.supabase.co"),
  "import.meta.env.VITE_SUPABASE_KEY": JSON.stringify("demo-key"),
};
// The demo's page: its own title, and kept out of search engines.
const demoPage = {
  name: "demo-page",
  transformIndexHtml: (html) => html
    .replace(/<title>[^<]*<\/title>/, "<title>ThinkGita Circles Demo</title>")
    .replace("</head>", '  <meta name="robots" content="noindex, nofollow" />\n  </head>'),
};
export default defineConfig(({ mode }) => mode === "demo"
  ? { plugins: [react(), demoPage], base: process.env.DEMO_BASE || "./", define: DEMO }
  : { plugins: [react()], base: "./" });
