import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works at https://<org>.github.io/<repo>/
// Demo build (npm run build:demo): made-up data answered in the browser by src/demo/install.js, and a made-up Supabase
// address so nothing can ever reach the real project.
const DEMO = {
  "import.meta.env.VITE_DEMO": JSON.stringify("1"),
  "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://thinkgita-demo.supabase.co"),
  "import.meta.env.VITE_SUPABASE_KEY": JSON.stringify("demo-key"),
};
export default defineConfig(({ mode }) => ({ plugins: [react()], base: "./", define: mode === "demo" ? DEMO : {} }));
