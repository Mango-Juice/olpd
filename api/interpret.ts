import type { IncomingMessage, ServerResponse } from "node:http";
import { handleInterpret } from "../server/http.js";

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return handleInterpret(req, res);
}
