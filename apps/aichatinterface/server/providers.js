export const PROVIDERS = {
  orchestrator: {
    id: 'orchestrator',
    label: 'Local Orchestrator',
    baseUrl: process.env.ORCHESTRATOR_BASE_URL || 'http://localhost:8788/v1',
    envKey: 'ORCHESTRATOR_API_KEY',
    keyless: true,
    dynamicModels: true,
    models: [],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    keyless: false,
    models: [
      { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    keyless: false,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'o3-mini', label: 'o3-mini' },
    ],
  },
  local: {
    id: 'local',
    label: 'Local / Compatible',
    baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1',
    envKey: 'LOCAL_API_KEY',
    keyless: true,
    dynamicModels: true,
    models: [],
  },
}

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    baseUrl: p.baseUrl,
    keyless: p.keyless,
    hasServerKey: Boolean(p.keyless || process.env[p.envKey]),
    models: p.models,
  }))
}

export function getProvider(id) {
  return PROVIDERS[id] || null
}