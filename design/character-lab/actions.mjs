// Shared state vocabulary for the Nibbi character lab.
// These are the moments the character must carry without a panel.
export const ACTIONS = Object.freeze([
  { id: 'idle',    label: 'Idle',    loop: true,  note: 'Quiet. Reading or typing nearby. Nothing should compete with the pill.' },
  { id: 'hello',   label: 'Hello',   loop: false, note: 'Greeting on entry or a deliberate tap. One responsive gesture.' },
  { id: 'listen',  label: 'Listen',  loop: true,  note: 'Composer focused / mic open. Attention toward the person.' },
  { id: 'think',   label: 'Think',   loop: true,  note: 'Lead is composing a reply. Low amplitude; never frantic.' },
  { id: 'work',    label: 'Work',    loop: true,  note: 'Fixers are building in worktrees. Long-running; must stay watchable for minutes.' },
  { id: 'success', label: 'Success', loop: false, note: 'A merge landed / milestone reached. Let the win land once, then settle.' },
  { id: 'error',   label: 'Error',   loop: false, note: 'A run failed. Readable, restrained, never celebratory.' },
  { id: 'sleep',   label: 'Sleep',   loop: true,  note: 'Rest after inactivity. Really settles; slow breath only.' },
  { id: 'tap',     label: 'Tap',     loop: false, note: 'Direct play: pointer/touch on the body. Short, physical, interruptible.' },
]);
export const ACTION_IDS = ACTIONS.map(a => a.id);
export const isLoop = id => !!ACTIONS.find(a => a.id === id)?.loop;
// Sizes the character must survive: hero stage, the conversation pill avatar, chat-row avatar.
export const SIZES = Object.freeze([
  { id: 'hero', R: 96, label: 'Hero' },
  { id: 'pill', R: 26, label: 'Pill' },
  { id: 'tiny', R: 12, label: 'Chat row' },
]);
