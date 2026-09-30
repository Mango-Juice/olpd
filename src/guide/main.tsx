import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "@fontsource/gowun-batang/400.css";
import "@fontsource/gowun-batang/700.css";
import "../styles.css";
import "./guide.css";
import { GuidePage } from "./GuidePage";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GuidePage />
  </React.StrictMode>,
);
