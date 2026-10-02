const PATTERNS = [
  {
    route: "parallel-analysis",
    re: /\b(compare|analysis|analy[sz]e|angles|brainstorm|options|trade-?offs?|pros and cons|deep dive|break down|multi-?step|reason through|evaluate|contrast)\b/i,
  },
  {
    route: "creative-writing",
    re: /\b(story|poem|write|fiction|creative|screenplay|lyrics|novel|essay|blog post|marketing copy|headline|character|plot)\b/i,
  },
];

export function heuristicRoute(userText) {
  const text = userText || "";
  for (const { route, re } of PATTERNS) {
    if (re.test(text)) return route;
  }
  return "general-chat";
}
