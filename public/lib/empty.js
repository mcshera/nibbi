/* lib/empty.js — the one empty state. A surface with nothing to show says so in one spoken sentence,
   in muted type, and offers at most the one thing that would fill it (placed by the caller). Every
   empty state used to be its own ad-hoc string and element; this is the part a new surface reaches for. */
export function emptyLine(text, className = 'margin-empty') {
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  return line;
}
