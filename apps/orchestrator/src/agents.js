export const AGENT_ROUTES = {
  "agent-fast-chat": "general-chat",
  "agent-creative-writer": "creative-writing",
  "agent-parallel-thinker": "parallel-analysis",
  "agent-analyst": "parallel-analysis",
};

export const AGENTS = [
  { id: "agent-auto", object: "model", owned_by: "orchestrator" },
  { id: "agent-fast-chat", object: "model", owned_by: "orchestrator" },
  { id: "agent-creative-writer", object: "model", owned_by: "orchestrator" },
  { id: "agent-parallel-thinker", object: "model", owned_by: "orchestrator" },
  { id: "agent-analyst", object: "model", owned_by: "orchestrator" },
];

export function routeForAgent(model) {
  if (!model) return null;
  return AGENT_ROUTES[model] ?? null;
}
