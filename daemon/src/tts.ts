// tts.ts — local speech synthesis: macOS `say` → ffmpeg → OGG/Opus (Telegram+web compatible)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BIN_FFMPEG = join(homedir(), ".nibbi", "bin", "ffmpeg");
const TMP = join(homedir(), ".nibbi", "tmp");

/** Make text speakable: strip markdown/chrome, cap length. */
export function speakable(text: string, cap = 650): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/[*_`#>|]/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

function synthKokoro(clean: string): string | null {
  try {
    const ogg = execFileSync(join(homedir(), ".nibbi", "bin", "tts-kokoro"), [clean],
      { encoding: "utf8", timeout: 60_000 }).trim();
    return ogg.endsWith(".ogg") ? ogg : null;
  } catch { return null; }
}
function synthSay(clean: string): string {
  mkdirSync(TMP, { recursive: true });
  const base = join(TMP, `tts-${Date.now()}`);
  execFileSync("say", ["-v", "Samantha", "-o", `${base}.aiff`, clean], { timeout: 30_000 });
  execFileSync(BIN_FFMPEG, ["-y", "-i", `${base}.aiff`, "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", `${base}.ogg`],
    { timeout: 30_000, stdio: "ignore" });
  return `${base}.ogg`;
}

/** Synthesize to OGG/Opus. Normally Kokoro (near-human); in low-usage mode use the instant system
    voice so it doesn't fight the local LLM for RAM (override with ORACLE_LOW_VOICE=kokoro). */
export function synthOgg(text: string, preferSay = false): string {
  const clean = speakable(text);
  if (preferSay && process.env.ORACLE_LOW_VOICE !== "kokoro") return synthSay(clean);
  return synthKokoro(clean) ?? synthSay(clean);
}
