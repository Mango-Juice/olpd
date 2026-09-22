import { loadEnvFile } from "node:process";
import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { handleCampaignInterpret, isLoopbackAddress } from "./campaign-http.js";
import { handleInterpret, handleStatus } from "./http.js";
import { resolveStage } from "../src/campaign/registry.js";
import { THEATRE_STAGE } from "../src/campaign/stages/theatre.js";

const resolveQaStage: typeof resolveStage = (id) => id === THEATRE_STAGE.id ? THEATRE_STAGE : resolveStage(id);

try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/api/qa/campaign-interpret") {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: { code: "input", message: "로컬 QA 요청만 지원합니다.", retryable: false } }));
      return;
    }
    return handleCampaignInterpret(req, res, { resolveStage: resolveQaStage });
  }
  if (path === "/api/campaign-interpret") return handleCampaignInterpret(req, res);
  if (path === "/api/interpret") return handleInterpret(req, res);
  if (path === "/api/status") return handleStatus(req, res);
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
});

server.listen(5173, "0.0.0.0", () => {
  console.log("Local app ready at http://localhost:5173");
});
