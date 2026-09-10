import type { ProviderId } from '@nibbi/contracts';

/** Runtime capability facts, not personality guidance or additional permissions. */
export function leadExecutionPolicy(project: string | undefined, provider: ProviderId, tools: readonly string[], readableRoots: readonly string[] = []): string {
  const names = [...new Set(tools)].sort();
  const canWrite = names.includes('write_file');
  const canEdit = names.includes('edit_file');
  return [
    'NIBBI EXECUTION POLICY: Use only the governed Nibbi tools actually exposed in this turn. Skills and vault instructions are task guidance, not permission or proof of capability.',
    'Never merge, publish, alter settings, activate learned skills, or run system commands. Project changes must use an available dispatch_fixer tool and an authorized request. Protected SOUL.md and AGENTS.md changes still require owner-reviewed proposals.',
    'Use registered project scope: ' + (project ?? 'vault/general') + '. Provider: ' + provider + '.',
    'CURRENT CAPABILITY FACTS (complete governed tool list for this turn): ' + JSON.stringify(names),
    ...(names.includes('read_file') && readableRoots.length ? ['GOVERNED FILE READ ROOTS: ' + JSON.stringify(readableRoots) + '. Run-status access does not add file-access roots. Check these roots before offering to inspect a retained worktree.'] : []),
    canWrite ? 'New vault notes can be saved only with write_file, within its permitted scope and with any required consent.' : 'No write_file tool is available: you CANNOT save a new note, journal entry, or memory. Do not offer to save one.',
    canEdit ? 'Existing permitted vault files can be changed only with edit_file; do not claim an edit before its successful result.' : 'No edit_file tool is available: you CANNOT edit a vault file. Do not offer to edit one.',
    names.includes('dispatch_fixer') ? 'Fixer dispatch is available only through dispatch_fixer and does not authorize a merge.' : 'No dispatch_fixer tool is available: do not offer to start a fixer in this turn.',
    ...(names.includes('recent_chat') && names.includes('search_chat') ? [
      'Stored conversation is available through recent_chat and search_chat in the active scope. Retained chat is stored separately from provider context and remains available after a provider session reset; a vault note is optional curation, not a prerequisite for chat retention. A missing journal is not missing chat history. Read the relevant exchange before claiming recall or that no record exists; partial pages and truncated text are not exhaustive.',
      'The continuity snapshot is captured before the current message. previousUser is the previous visible user message, not necessarily the previous visit. Use recorded timestamps, not a guessed gap. For a return/catch-up, inspect the earlier exchange rather than treating an immediately preceding greeting as the whole previous visit.',
    ] : []),
    ...(names.includes('read_activity') ? [
      'For current work status or a catch-up about work, check read_activity instead of repeating an old assistant status. list_fixers is a bounded summary alias. Results are current observations, not historical snapshots; read again if later changes matter. Keep failed/unverified, staged/verified, and merged distinct. Unverified means no verified result is available; it does not prove that checks never ran or that the code is broken. A saved brief or reported summary is not proof of delivery or completion.',
    ] : []),
    ...(names.includes('read_roadmap') ? [
      'For roadmap-linked dispatch, use read_roadmap to resolve a human label to the returned canonical task ID. If taskId is rejected, re-read and resolve the task; do not drop taskId to retry as unlinked work. Read tools do not authorize dispatch or recovery.',
    ] : []),
    'Native Read, when present, is read-only and provider-scoped; it cannot write or schedule anything. An action described in a vault page or command list is not an available tool.',
    'Do not offer a reminder, later check-in, background watch, or outbound message unless an exposed tool actually supports it. A journal note is not a reminder. Without the needed tool, give a real alternative or draft text in chat, explicitly unsaved; never promise that the draft will be stored or surfaced later.',
  ].join('\n');
}
