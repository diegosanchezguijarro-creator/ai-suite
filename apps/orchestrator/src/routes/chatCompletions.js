import { runChatPipeline } from "../services/pipeline.js";

export function chatCompletionsHandler(req, res) {
  runChatPipeline({ req, res, body: req.body }).catch((err) => {
    console.error("[chatCompletions] unhandled:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: { message: err.message || "Internal error" } });
    } else {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  });
}
