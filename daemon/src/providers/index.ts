import type { ProviderId } from '@nibbi/contracts';
import type { AgentProvider } from './types.js';
import { claude } from './claude.js';
import { codex } from './codex.js';
const registry: Record<ProviderId, AgentProvider> = { claude, codex };
export const providerFor = (id: ProviderId): AgentProvider => registry[id];
/** Dependency injection for deterministic tests; never configured through HTTP. */
export function replaceProviderForTest(id: ProviderId, provider: AgentProvider): () => void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test providers are disabled');
  const previous = registry[id]; registry[id] = provider; return () => { registry[id] = previous; };
}
