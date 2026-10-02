import { AGENTS } from "../agents.js";
import { getOrchestratorModels } from "../lib/opencodeModels.js";

export async function modelsHandler(req, res) {
  try {
    const data = await getOrchestratorModels();
    res.json(data);
  } catch (err) {
    console.error("[models] fallback to agents only:", err.message);
    res.json({ object: "list", data: AGENTS });
  }
}
