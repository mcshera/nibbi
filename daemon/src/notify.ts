import { runtime } from './store.js';
export async function notifyOwner(_bot: unknown, text: string, silent = false): Promise<void> {
  runtime().emit({ type: 'brief', payload: { text: text.slice(0, 8000), silent } });
}
