import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyTheme, getTheme } from "./ui.jsx";
import "./styles.css";

applyTheme(getTheme());
createRoot(document.getElementById("root")).render(<App />);
