import React from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, getTheme } from "./ui.jsx";
import { SUPABASE_URL } from "./config.js";
import "./styles.css";

applyTheme(getTheme());

// The demo build (npm run build:demo) answers every Supabase request in the browser from made-up data, so the fake
// backend has to be in place before the app (and its Supabase client) loads.
async function start() {
  let bar = null;
  if (import.meta.env.VITE_DEMO) {
    const { installDemo } = await import("./demo/install.js");
    const role = installDemo(SUPABASE_URL);
    const { DemoBar } = await import("./demo/DemoBar.jsx");
    bar = <DemoBar role={role} />;
  }
  const { default: App } = await import("./App.jsx");
  createRoot(document.getElementById("root")).render(<>{bar}<App /></>);
}
start();
