import { loadEnvFile } from "node:process";
import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { handleInterpret, handleStatus } from "./http.js";

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
