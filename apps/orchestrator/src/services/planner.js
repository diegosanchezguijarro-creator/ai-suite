function parseSubTasks(text) {
  if (!text) return null;
  const trimmed = text.trim();

  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const bracketed = trimmed.match(/\[[\s\S]*\]/);
  if (bracketed?.[0]) candidates.push(bracketed[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      const tasks = parsed
        .map((item, index) => {
          if (typeof item === "string") {
            return { id: `task-${index + 1}`, task: item };
          }
          if (item && typeof item === "object") {
            return {
              id: String(item.id || `task-${index + 1}`),
              task: String(item.task || item.description || item.text || ""),
            };
          }
          return null;
        })
        .filter((item) => item && item.task.trim().length > 0);
      if (tasks.length > 0) return tasks.slice(0, 4);
    } catch {
      // try next candidate
    }
  }
  return null;
}

const DEFAULT_SUB_TASKS = [
  { id: "task-1", task: "Identify the core question and key constraints in the user's request." },
  { id: "task-2", task: "Develop one strong primary perspective or solution path with concrete details." },
  { id: "task-3", task: "Offer an alternative perspective, edge cases, or risks that a single answer might miss." },
];

function workerMessages({ system, messages, userText, task }) {
  return [
    {
      role: "system",
      content: `${system}\n\nYou are a focused worker agent. Complete ONLY the assigned sub-task for the user's request. Do not write the full final answer; contribute your assigned piece with enough detail to be useful for synthesis.`,
    },
    ...(messages || []),
    {
      role: "user",
      content: `User request:\n${userText}\n\nYour sub-task (${task.id}): ${task.task}`,
    },
  ];
}

function synthesisMessages({ system, messages, userText, workerResults, feedback }) {
  const workerBlock = workerResults
    .map((result, index) => `--- Worker output ${index + 1} ---\n${result}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: `${system}\n\nYou are a synthesizer. Weave the worker outputs into ONE cohesive, polished response that directly answers the user's request. Resolve contradictions; do not list the workers' outputs separately.`,
    },
    ...(messages || []),
    {
      role: "user",
      content: [
        `User request:\n${userText}`,
        `Worker outputs:\n${workerBlock}`,
        feedback ? `Revision feedback from reviewer:\n${feedback}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export async function synthesizerDraft({
  generative,
  strongGenerative = null,
  system,
  messages,
  userText,
  workerResults,
  signal,
  feedback = null,
  telemetry = null,
}) {
  const msgs = synthesisMessages({ system, messages, userText, workerResults, feedback });
  telemetry?.emit({
    layer: "synthesizer",
    status: "running",
    prompt: msgs,
    feedback,
    model: strongGenerative?.model || generative.model,
  });
  const result = await (strongGenerative || generative).generate({
    system: null,
    messages: msgs,
    signal,
    // Generous so reasoning-capable models fit chain-of-thought AND the draft.
    maxTokens: 10240,
  });
  telemetry?.emit({ layer: "synthesizer", status: "done", model: strongGenerative?.model || generative.model });
  return result;
}

export async function runParallelAnalysis({
  generative,
  strongGenerative = null,
  system,
  messages,
  userText,
  signal,
  telemetry,
}) {
  telemetry?.emit({
    layer: "planner",
    status: "running",
    detail: "generating sub-tasks",
    model: generative.model,
  });

  const planMessages = [
    {
      role: "system",
      content: `${system}\n\nYou are a planning model. Given the user request, output ONLY a JSON array of 2-4 independent sub-tasks that together cover the request. Each item must be an object: { "id": "string", "task": "string" }. No prose before or after the JSON.`,
    },
    ...(messages || []),
    {
      role: "user",
      content: `User request:\n${userText}\n\nReturn only the JSON array of sub-tasks.`,
    },
  ];

  const planText = await generative.generate({
    system: null,
    messages: planMessages,
    signal,
    maxTokens: 4096,
  });

  const subTasks = parseSubTasks(planText) || DEFAULT_SUB_TASKS;
  telemetry?.emit({ layer: "planner", status: "done", subTasks, prompt: planMessages });

  telemetry?.emit({ layer: "workers", status: "running", taskCount: subTasks.length });
  const workerResults = await Promise.all(
    subTasks.map((task) => {
      const msgs = workerMessages({ system, messages, userText, task });
      telemetry?.emit({ layer: "worker", status: "running", taskId: task.id, prompt: msgs });
      return generative.generate({
        system: null,
        messages: msgs,
        signal,
        maxTokens: 6144,
      });
    })
  );
  telemetry?.emit({
    layer: "workers",
    status: "done",
    results: workerResults.map((text, index) => ({ taskId: subTasks[index]?.id, text })),
  });

  const draft = await synthesizerDraft({
    generative,
    strongGenerative,
    system,
    messages,
    userText,
    workerResults,
    signal,
    feedback: null,
    telemetry,
  });

  return { draft, subTasks, workerResults };
}