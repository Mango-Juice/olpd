import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";

// 공유 주소에서 끝 슬래시가 빠져도 게임 대신 안내 페이지가 열리게 한다. 배포본은 vercel.json 이 맡는다.
const guideSlash: Connect.NextHandleFunction = (req, res, next) => {
  const [path, query] = (req.url ?? "").split("?");
  if (path !== "/guide") return next();
  res.statusCode = 308;
  res.setHeader("Location", "/guide/" + (query ? "?" + query : ""));
  res.end();
};
const guideRedirect: Plugin = {
  name: "guide-trailing-slash",
  configureServer(server) { server.middlewares.use(guideSlash); },
  configurePreviewServer(server) { server.middlewares.use(guideSlash); },
};
export default defineConfig({
  plugins: [react(), guideRedirect],
  server: { host: "0.0.0.0" },
  build: { rollupOptions: { input: { main: "index.html", guide: "guide/index.html" } } },
  test: { include: ["tests/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
