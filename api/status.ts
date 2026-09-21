import type { IncomingMessage, ServerResponse } from "node:http";
import { handleStatus } from "../server/http.js";

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  handleStatus(req, res);
}
