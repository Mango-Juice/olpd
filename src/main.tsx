import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import CampaignShell from "./CampaignShell";
import "@fontsource-variable/noto-sans-kr";
import "@fontsource/gowun-batang/400.css";
import "@fontsource/gowun-batang/700.css";
import "./styles.css";
const localQa = import.meta.env.DEV
  && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  && new URLSearchParams(location.search).get("qa") === "1";
const QaShell = import.meta.env.DEV ? lazy(() => import("./QaShell")) : () => null;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {localQa ? <Suspense fallback={<p>QA 모드를 여는 중…</p>}><QaShell /></Suspense> : <CampaignShell />}
  </React.StrictMode>,
);
