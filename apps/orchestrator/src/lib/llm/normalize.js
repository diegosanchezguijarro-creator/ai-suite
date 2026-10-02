export function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

export function extractImageUrls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === "image_url" && part.image_url?.url)
    .map((part) => part.image_url.url)
    .filter((url) => typeof url === "string" && url.startsWith("data:"));
}

export function parseDataUri(url) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

export function toAnthropicMessages(messages) {
  const out = [];
  for (const message of messages || []) {
    const role = message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = extractText(message.content);
    const images = extractImageUrls(message.content);
    if (images.length === 0) {
      out.push({ role, content: text || "(no content)" });
      continue;
    }
    const blocks = [];
    if (text) blocks.push({ type: "text", text });
    for (const url of images) {
      const parsed = parseDataUri(url);
      if (parsed) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: parsed.mediaType,
            data: parsed.base64,
          },
        });
      }
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: "(attachment omitted)" });
    out.push({ role, content: blocks });
  }
  return out;
}

export function toOpenAiMessages(messages, system) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  for (const message of messages || []) {
    if (!message) continue;
    if (message.role === "system" && system) continue;
    out.push({ role: message.role, content: message.content ?? "" });
  }
  return out;
}
