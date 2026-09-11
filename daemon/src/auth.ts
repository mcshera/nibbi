import { CodexRpc } from './providers/codex.js';
import { claudeStatus } from './providers/claude-auth.js';
import { config } from './config.js';
import { runtime } from './store.js';
let login: CodexRpc | undefined;
export async function providerStatus(): Promise<unknown> {
  const claude = await claudeStatus();
  let codex = false, codexError: string | undefined;
  const rpc = new CodexRpc(config.vaultDir);
  try { await rpc.initialize(); const result = await rpc.request<{ account?: unknown }>('account/read', { refreshToken: false }); codex = !!result.account; }
  catch (error) { codexError = (error as Error).message; }
  finally { rpc.close(); await rpc.exited; }
  return { claude, codex: { connected: codex, error: codexError }, cost: 'Claude sign-in uses your plan limits; SDK dollar estimates are not reported as API charges. Unavailable costs are never shown as zero.' };
}
export async function loginCodex(): Promise<unknown> {
  login?.close(); const rpc = new CodexRpc(config.vaultDir); login = rpc;
  await rpc.initialize();
  const timer = setTimeout(() => { rpc.close(); if (login === rpc) login = undefined; }, 10 * 60_000); timer.unref();
  rpc.on('notification', (method: string, params: Record<string, unknown>) => {
    if (method === 'account/login/completed') { runtime().emit({ type: 'provider.auth', payload: { provider: 'codex', success: params.success === true } }); clearTimeout(timer); rpc.close(); if (login === rpc) login = undefined; }
  });
  try { return await rpc.request('account/login/start', { type: 'chatgpt' }); }
  catch (error) { clearTimeout(timer); rpc.close(); throw error; }
}
export async function stopAuth(): Promise<void> { const rpc = login; login = undefined; rpc?.close(); await rpc?.exited; }
