import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works at https://<org>.github.io/<repo>/
export default defineConfig({ plugins: [react()], base: "./" });
