import type { IncomingMessage, ServerResponse } from "node:http";
import { handleCampaignInterpret } from "../server/campaign-http.js";
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleCampaignInterpret(req, res);
}
