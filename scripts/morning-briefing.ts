/**
 * Morning Briefing — sends a Claude-generated daily greeting to a Telegram group chat.
 *
 * Usage:
 *   bun run scripts/morning-briefing.ts          # one-shot
 *   npm run briefing                              # same, via package.json
 *
 * Schedule with the companion LaunchAgent: daemon/morning-briefing.plist
 *
 * Requires .env:
 *   TELEGRAM_BOT_TOKEN   — bot token from BotFather
 *   TELEGRAM_GROUP_CHAT_ID — target group (use /chatid to discover)
 */

import { spawn } from "bun";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// CONFIG
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const TIMEOUT_MS = 120_000; // 2 minutes
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";

let supabase: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
}

// ============================================================
// MARKDOWN → TELEGRAM HTML  (copied from src/relay.ts)
// ============================================================

function markdownToTelegramHTML(text: string): string {
  const placeholders: string[] = [];
  function ph(content: string): string {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\x00PH${idx}\x00`;
  }

  let result = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks
  result = result.replace(/```(?:\w*)\n([\s\S]*?)```/g, (_m, code) =>
    ph(`<pre>${code.replace(/\n$/, "")}</pre>`)
  );
  // Inline code
  result = result.replace(/`([^`\n]+)`/g, (_m, code) =>
    ph(`<code>${code}</code>`)
  );
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // Italic
  result = result.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Restore placeholders
  result = result.replace(/\x00PH(\d+)\x00/g, (_m, idx) =>
    placeholders[parseInt(idx)]
  );
  return result;
}

// ============================================================
// TELEGRAM SEND
// ============================================================

async function sendTelegram(
  text: string,
  parseMode?: "HTML" | "Markdown"
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: CHAT_ID,
    text,
  };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error(`Telegram API error (${res.status}):`, err);
  }
  return res.ok;
}

// ============================================================
// CALL CLAUDE CLI
// ============================================================

async function callClaude(prompt: string): Promise<string> {
  const args = [CLAUDE_PATH, "-p", prompt, "--output-format", "json"];

  console.log("Spawning Claude CLI…");
  const proc = spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error("Claude CLI timed out, killing…");
    proc.kill();
    setTimeout(() => {
      try {
        process.kill(proc.pid, 0);
        proc.kill(9);
      } catch {
        /* already dead */
      }
    }, 5000);
  }, TIMEOUT_MS);

  let output: string;
  try {
    output = await Promise.race([
      new Response(proc.stdout).text(),
      new Promise<never>((_, reject) => {
        if (timedOut) reject(new Error("timed out"));
        // The timeout above will kill the process, causing the read to end
        // but we also need a promise that rejects on timeout
        const check = setInterval(() => {
          if (timedOut) {
            clearInterval(check);
            reject(new Error("Claude CLI timed out"));
          }
        }, 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) throw new Error("Claude CLI timed out");

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Claude exited ${exitCode}: ${stderr}`);
  }

  try {
    const json = JSON.parse(output);
    return json.result || output.trim();
  } catch {
    return output.trim();
  }
}

// ============================================================
// GENERAL CONFERENCE QUOTES
// ============================================================

type Quote = { quote: string; speaker: string; talk: string; conference: string };

// Fallback quotes if Supabase is unavailable
const FALLBACK_QUOTES: Quote[] = [
  { quote: "Your origin story is divine, and so is your destiny. You left heaven to come here, but heaven has never left you!", speaker: "Dieter F. Uchtdorf", talk: "Do Your Part with All Your Heart", conference: "October 2025" },
  { quote: "If we remain faithful in our service, the Lord will refine us. He will strengthen us. And one day we will look back and see that those very trials were evidence of His love.", speaker: "Henry B. Eyring", talk: "Proved and Strengthened in Christ", conference: "October 2025" },
  { quote: "All of us can have a new beginning through, and because of, Jesus Christ. Even you.", speaker: "Patrick Kearon", talk: "Jesus Christ and Your New Beginning", conference: "October 2025" },
  { quote: "The fundamental purposes for the exercise of agency are to love one another and to choose God.", speaker: "David A. Bednar", talk: "They Are Their Own Judges", conference: "October 2025" },
  { quote: "To be a peacemaker is not to be weak—but to be strong in a way the world may not understand.", speaker: "Gary E. Stevenson", talk: "Blessed Are the Peacemakers", conference: "October 2025" },
];

async function getTodaysQuote(): Promise<Quote> {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);

  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("conference_quotes")
        .select("quote, speaker, talk, conference");
      if (!error && data && data.length > 0) {
        console.log(`Loaded ${data.length} quotes from Supabase`);
        return data[dayOfYear % data.length];
      }
      if (error) console.warn("Supabase quotes fetch error:", error.message);
    } catch (err) {
      console.warn("Supabase quotes fetch failed:", err);
    }
  }

  console.log("Using fallback quotes");
  return FALLBACK_QUOTES[dayOfYear % FALLBACK_QUOTES.length];
}

// ============================================================
// FETCH YESTERDAY'S ACTIVITY FROM SUPABASE
// ============================================================

async function getYesterdaySummaries(): Promise<string[]> {
  if (!supabase) return [];
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("telegram_sessions")
      .select("summary, closed_at")
      .gte("closed_at", yesterday.toISOString())
      .lt("closed_at", today.toISOString())
      .not("summary", "is", null)
      .order("closed_at", { ascending: true });

    if (error || !data) {
      console.warn("Failed to fetch summaries:", error?.message);
      return [];
    }
    return data.map((r) => r.summary).filter(Boolean);
  } catch (err) {
    console.warn("Supabase fetch error:", err);
    return [];
  }
}

// ============================================================
// BUILD PROMPT
// ============================================================

function buildPrompt(summaries: string[], quote: Quote): string {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const activitySection =
    summaries.length > 0
      ? [
          "",
          "Here are summaries of yesterday's sessions on the Farm Built app (from Supabase):",
          ...summaries.map((s, i) => `${i + 1}. ${s}`),
          "",
          "Use these summaries to write a brief 'Yesterday' recap and suggest what to work on next today.",
        ].join("\n")
      : "\nNo sessions were logged yesterday — mention that it was a quiet day and suggest picking things back up.";

  return [
    `Today is ${date}.`,
    "",
    "Write a short, warm morning greeting for a group chat with two people: Saia and Rocky.",
    "Include:",
    "- A friendly good-morning line addressing Saia and Rocky by name",
    "- The date and day of the week",
    `- This conference quote, displayed as a standalone block — just the quote in italics, then on the next line "-- ${quote.speaker}". Do NOT weave it into surrounding text or add commentary around it:`,
    `  "${quote.quote}" — ${quote.speaker}`,
    "- A **Farm Built Update** section with a brief recap of yesterday's activity and what to focus on today",
    activitySection,
    "",
    "Formatting rules:",
    "- Do NOT use horizontal rules (---) to separate sections",
    "- Do NOT use blockquote (>) syntax",
    "- Use blank lines between sections instead",
    "- Use markdown bold and italic for emphasis",
    "",
    "Keep it concise — under 200 words. Be warm and natural, like texting friends.",
  ].join("\n");
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!BOT_TOKEN) {
    console.error("Missing TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
  }
  if (!CHAT_ID) {
    console.error(
      "Missing TELEGRAM_GROUP_CHAT_ID in .env — use /chatid in the group to find it"
    );
    process.exit(1);
  }

  console.log("Fetching yesterday's activity from Supabase…");
  const summaries = await getYesterdaySummaries();
  console.log(`Found ${summaries.length} session(s) from yesterday`);

  console.log("Picking today's conference quote…");
  const quote = await getTodaysQuote();
  console.log(`Quote: "${quote.quote.substring(0, 50)}…" — ${quote.speaker}`);

  console.log("Generating morning briefing…");

  let markdown: string;
  try {
    markdown = await callClaude(buildPrompt(summaries, quote));
  } catch (err) {
    console.error("Claude CLI failed:", err);
    process.exit(1);
  }

  console.log("Briefing generated, sending to Telegram…");

  // Try HTML first, fall back to plain text
  const html = markdownToTelegramHTML(markdown);
  let sent = await sendTelegram(html, "HTML");
  if (!sent) {
    console.warn("HTML send failed, retrying as plain text…");
    sent = await sendTelegram(markdown);
  }

  if (sent) {
    console.log("Morning briefing sent successfully!");
  } else {
    console.error("Failed to send briefing");
    process.exit(1);
  }
}

main();
