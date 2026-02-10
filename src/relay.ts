/**
 * Claude Code Telegram Relay
 *
 * Minimal relay that connects Telegram to Claude Code CLI.
 * Customize this for your own needs.
 *
 * Run: bun run src/relay.ts
 */

import { Bot, Context } from "grammy";
import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { join } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// CONFIGURATION
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USER_IDS = (process.env.TELEGRAM_USER_ID || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);
// Per-user role configuration
interface UserRole {
  name: string;
  role: "owner" | "pm";
  allowedTools: string;
  systemPrompt: string;
}

const USER_ROLES: Record<string, UserRole> = {
  "8493500703": {
    name: "Mot",
    role: "owner",
    allowedTools: "Bash,Edit,Read,Glob,Grep,Write",
    systemPrompt: "",  // uses default autonomous prompt
  },
  "8253689321": {
    name: "Rocky",
    role: "pm",
    allowedTools: "Bash,Edit,Read,Glob,Grep",
    systemPrompt: `You are helping a product manager make small changes to the codebase.

RULES:
- Only make small, focused changes: text/copy edits, config values, simple styling tweaks, minor bug fixes
- NEVER refactor, restructure, or rewrite large sections of code
- NEVER delete files or remove significant functionality
- NEVER modify build configs, CI/CD, or infrastructure
- NEVER modify convex/schema.ts or add/remove Convex tables
- If a request seems too large or risky, explain what it would involve and suggest the user ask a developer instead
- After making a change, briefly describe what you changed and where

GIT & DEPLOY WORKFLOW:
- After every change, commit and push to main
- Use clear, descriptive commit messages
- Always git add only the specific files you changed (never git add -A)
- If you edited any files inside convex/, run: npx convex deploy --yes
  - Run this BEFORE git push
  - If it fails, do not push — report the error instead
- Push to main after committing — this triggers a live Netlify deploy`,
  },
};

function getUserRole(userId: string | undefined): UserRole | null {
  if (!userId) return null;
  return USER_ROLES[userId] || null;
}

function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function shouldRespondInGroup(ctx: Context): boolean {
  const botUsername = ctx.me.username.toLowerCase();

  // Check @mentions in message entities
  const entities = ctx.message?.entities || ctx.message?.caption_entities || [];
  for (const entity of entities) {
    if (entity.type === "mention") {
      const text = ctx.message?.text || ctx.message?.caption || "";
      const mention = text.substring(entity.offset, entity.offset + entity.length);
      if (mention.toLowerCase() === `@${botUsername}`) return true;
    }
  }

  // Check if replying to the bot
  if (ctx.message?.reply_to_message?.from?.id === ctx.me.id) return true;

  return false;
}

function stripBotMention(text: string, botUsername: string): string {
  const regex = new RegExp(`@${botUsername}\\b`, "gi");
  return text.replace(regex, "").replace(/\s{2,}/g, " ").trim();
}

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const RELAY_DIR = process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");
const CLAUDE_WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/Users/motbot/workspace/family-built";
const AUTONOMOUS_MODE = process.env.AUTONOMOUS_MODE === "true";
const AUDIT_LOG_DIR = join(RELAY_DIR, "audit");

// Session lifecycle thresholds
const SESSION_MAX_MESSAGES = parseInt(process.env.SESSION_MAX_MESSAGES || "30");
const SESSION_IDLE_TIMEOUT_MIN = parseInt(process.env.SESSION_IDLE_TIMEOUT_MIN || "30");
const SESSION_MEMORY_COUNT = parseInt(process.env.SESSION_MEMORY_COUNT || "3");

// Supabase client (nullable — gracefully degrades if not configured)
let supabase: SupabaseClient | null = null;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log("Supabase client initialized for session persistence");
} else {
  console.log("Supabase not configured — sessions will be local only");
}

// Directories
const TEMP_DIR = join(RELAY_DIR, "temp");
const UPLOADS_DIR = join(RELAY_DIR, "uploads");

// Session tracking for conversation continuity
const SESSION_FILE = join(RELAY_DIR, "session.json");
const CHILDREN_FILE = join(RELAY_DIR, "children.json");

interface SessionState {
  sessionId: string | null;
  lastActivity: string;
  messageCount: number;
  transcript: string;
  chatId: string | null;
  userIds: string[];
  startedAt: string;
}

function newSessionState(): SessionState {
  return {
    sessionId: null,
    lastActivity: new Date().toISOString(),
    messageCount: 0,
    transcript: "",
    chatId: null,
    userIds: [],
    startedAt: new Date().toISOString(),
  };
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

async function loadSession(): Promise<SessionState> {
  try {
    const content = await readFile(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(content);
    // Migrate old sessions missing new fields
    return {
      ...newSessionState(),
      ...parsed,
    };
  } catch {
    return newSessionState();
  }
}

async function saveSession(state: SessionState): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
}

let session = await loadSession();

// ============================================================
// SESSION LIFECYCLE
// ============================================================

const TRANSCRIPT_MAX_BYTES = 50 * 1024; // 50KB cap

function shouldCloseSession(): "idle" | "limit" | null {
  if (session.messageCount >= SESSION_MAX_MESSAGES) return "limit";
  const idleMs = Date.now() - new Date(session.lastActivity).getTime();
  if (session.messageCount > 0 && idleMs > SESSION_IDLE_TIMEOUT_MIN * 60 * 1000) return "idle";
  return null;
}

async function closeSession(reason: string): Promise<{ messageCount: number }> {
  const snapshot = { ...session };
  const count = snapshot.messageCount;
  console.log(`Closing session (reason: ${reason}, messages: ${count})`);

  // Reset local session immediately
  session = newSessionState();
  await saveSession(session);

  // Fire-and-forget: persist to Supabase + generate summary
  if (supabase && snapshot.transcript.length > 0) {
    void (async () => {
      try {
        // Insert transcript row
        const { data, error } = await supabase!.from("telegram_sessions").insert({
          conversation_id: snapshot.sessionId,
          chat_id: snapshot.chatId,
          user_ids: snapshot.userIds,
          transcript: snapshot.transcript,
          message_count: count,
          close_reason: reason,
          closed_at: new Date().toISOString(),
        }).select("id").single();

        if (error) {
          console.error("Supabase insert error:", error.message);
          return;
        }

        const rowId = data.id;
        console.log(`Session persisted to Supabase: ${rowId}`);

        // Generate summary via Claude (internal call — won't save session)
        const summaryPrompt = `Summarize this conversation transcript in 2-3 sentences. Focus on decisions made, tasks completed, and open items. Be concise.\n\n${snapshot.transcript.substring(0, 8000)}`;
        const summary = await callClaude(summaryPrompt, { internal: true });

        // Update row with summary
        const { error: updateError } = await supabase!.from("telegram_sessions").update({ summary }).eq("id", rowId);
        if (updateError) {
          console.error("Supabase summary update error:", updateError.message);
        } else {
          console.log(`Session summary saved for ${rowId}`);
        }
      } catch (err) {
        console.error("Session close background error:", err);
      }
    })();
  }

  return { messageCount: count };
}

async function trackMessage(text: string, userName: string, userId: string, chatId: string): Promise<void> {
  // Check if we should close the current session first
  const closeReason = shouldCloseSession();
  if (closeReason) {
    await closeSession(closeReason);
  }

  // Update session state
  session.messageCount++;
  session.lastActivity = new Date().toISOString();
  session.chatId = chatId;

  if (!session.userIds.includes(userId)) {
    session.userIds.push(userId);
  }

  if (!session.startedAt || session.messageCount === 1) {
    session.startedAt = new Date().toISOString();
  }

  // Append to transcript
  session.transcript += `${userName}: ${text}\n\n`;

  // Truncate from beginning if transcript exceeds cap
  if (session.transcript.length > TRANSCRIPT_MAX_BYTES) {
    const cutPoint = session.transcript.indexOf("\n\n", session.transcript.length - TRANSCRIPT_MAX_BYTES);
    session.transcript = cutPoint > -1 ? session.transcript.substring(cutPoint + 2) : session.transcript.substring(session.transcript.length - TRANSCRIPT_MAX_BYTES);
  }

  await saveSession(session);
}

async function trackResponse(response: string): Promise<void> {
  session.transcript += `Assistant: ${response}\n\n`;

  // Truncate from beginning if transcript exceeds cap
  if (session.transcript.length > TRANSCRIPT_MAX_BYTES) {
    const cutPoint = session.transcript.indexOf("\n\n", session.transcript.length - TRANSCRIPT_MAX_BYTES);
    session.transcript = cutPoint > -1 ? session.transcript.substring(cutPoint + 2) : session.transcript.substring(session.transcript.length - TRANSCRIPT_MAX_BYTES);
  }

  await saveSession(session);
}

// ============================================================
// CHILD PROCESS TRACKING (orphan cleanup)
// ============================================================

async function loadChildPids(): Promise<number[]> {
  try {
    const content = await readFile(CHILDREN_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveChildPids(pids: number[]): Promise<void> {
  await writeFile(CHILDREN_FILE, JSON.stringify(pids));
}

async function registerChildPid(pid: number): Promise<void> {
  const pids = await loadChildPids();
  pids.push(pid);
  await saveChildPids(pids);
}

async function unregisterChildPid(pid: number): Promise<void> {
  const pids = await loadChildPids();
  await saveChildPids(pids.filter(p => p !== pid));
}

async function cleanupOrphanedProcesses(): Promise<void> {
  const pids = await loadChildPids();
  console.log(`Found ${pids.length} tracked child PID(s)`);

  if (pids.length === 0) return;

  for (const pid of pids) {
    try {
      process.kill(pid, 0); // check if alive
    } catch {
      console.log(`PID ${pid} already dead, removing from tracking`);
      continue;
    }

    console.log(`Killing orphaned Claude process PID ${pid} (SIGTERM)...`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {}

    // Give it 5 seconds, then SIGKILL
    setTimeout(() => {
      try {
        process.kill(pid, 0); // still alive?
        console.log(`PID ${pid} still alive after SIGTERM, sending SIGKILL`);
        process.kill(pid, "SIGKILL");
      } catch {
        // already dead
      }
    }, 5000);
  }

  // Clear the tracking file
  await saveChildPids([]);
}

// ============================================================
// LOCK FILE (prevent multiple instances)
// ============================================================

const LOCK_FILE = join(RELAY_DIR, "bot.lock");

async function acquireLock(): Promise<boolean> {
  try {
    const existingLock = await readFile(LOCK_FILE, "utf-8").catch(() => null);

    if (existingLock) {
      const pid = parseInt(existingLock);
      try {
        process.kill(pid, 0); // Check if process exists
        console.log(`Another instance running (PID: ${pid})`);
        return false;
      } catch {
        console.log("Stale lock found, taking over...");
      }
    }

    await writeFile(LOCK_FILE, process.pid.toString());
    return true;
  } catch (error) {
    console.error("Lock error:", error);
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_FILE).catch(() => {});
}

// Cleanup on exit
process.on("exit", () => {
  try {
    require("fs").unlinkSync(LOCK_FILE);
  } catch {}
});
process.on("SIGINT", async () => {
  await notifyUsers("Bot is going offline.");
  await saveChildPids([]);
  await releaseLock();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await notifyUsers("Bot is going offline.");
  await saveChildPids([]);
  await releaseLock();
  process.exit(0);
});

// ============================================================
// SETUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  console.log("\nTo set up:");
  console.log("1. Message @BotFather on Telegram");
  console.log("2. Create a new bot with /newbot");
  console.log("3. Copy the token to .env");
  process.exit(1);
}

// Create directories
await mkdir(TEMP_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(AUDIT_LOG_DIR, { recursive: true });

// Validate autonomous mode configuration
if (AUTONOMOUS_MODE) {
  console.log("\n⚠️  AUTONOMOUS MODE ENABLED ⚠️");
  console.log(`Working directory: ${CLAUDE_WORKING_DIR}`);
  console.log("Claude will execute commands without permission prompts\n");

  // Verify working directory exists
  try {
    await readFile(join(CLAUDE_WORKING_DIR, ".git", "config"), "utf-8");
  } catch {
    console.error(`ERROR: CLAUDE_WORKING_DIR does not exist or is not a git repo: ${CLAUDE_WORKING_DIR}`);
    process.exit(1);
  }
}

// Acquire lock
if (!(await acquireLock())) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

// Clean up any orphaned Claude processes from a previous run
await cleanupOrphanedProcesses();

const bot = new Bot(BOT_TOKEN);

bot.catch((err) => {
  console.error("Bot error:", err);
});

// ============================================================
// SECURITY: Only respond to authorized user
// ============================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();

  if (ALLOWED_USER_IDS.length > 0 && (!userId || !ALLOWED_USER_IDS.includes(userId))) {
    console.log(`Unauthorized: ${userId}`);
    if (!isGroupChat(ctx)) {
      await ctx.reply("This bot is private.");
    }
    return;
  }

  await next();
});

// ============================================================
// CORE: Call Claude CLI
// ============================================================

const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string; userId?: string; internal?: boolean }
): Promise<string> {
  const args = [CLAUDE_PATH, "-p", prompt];

  // Resume previous session if available and requested (not for internal calls)
  if (options?.resume && !options?.internal && session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push("--output-format", "json");

  // Autonomous mode configuration
  if (AUTONOMOUS_MODE) {
    args.push("--permission-mode", "dontAsk");
    args.push("--add-dir", CLAUDE_WORKING_DIR);
    const role = getUserRole(options?.userId);
    const tools = role?.allowedTools || "Bash,Edit,Read,Glob,Grep,Write";
    args.push("--allowed-tools", tools);
  }

  console.log(`Calling Claude: ${prompt.substring(0, 50)}...`);
  if (AUTONOMOUS_MODE) {
    console.log(`Working directory: ${CLAUDE_WORKING_DIR}`);
    console.log(`Autonomous mode: enabled`);
  }

  // Audit log
  await auditLog({
    timestamp: new Date().toISOString(),
    prompt: prompt.substring(0, 200),
    sessionId: session.sessionId,
    workingDir: CLAUDE_WORKING_DIR,
    autonomousMode: AUTONOMOUS_MODE,
  });

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: CLAUDE_WORKING_DIR,
      env: {
        ...process.env,
        PWD: CLAUDE_WORKING_DIR,
        CLAUDE_ALLOWED_DIR: CLAUDE_WORKING_DIR,
      },
    });

    const pid = proc.pid;
    await registerChildPid(pid);

    try {
      // Race the Claude process against a timeout
      let timedOut = false;
      let timeoutTimer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          console.log(`Claude CLI timed out, sending SIGTERM to PID ${pid}`);
          proc.kill();
          // Escalate to SIGKILL after 5 seconds if still alive
          setTimeout(() => {
            try {
              process.kill(pid, 0); // check if still alive
              console.log(`PID ${pid} still alive after SIGTERM, sending SIGKILL`);
              proc.kill(9); // SIGKILL
            } catch {
              // already dead, good
            }
          }, 5000);
          reject(new Error("Claude CLI timed out"));
        }, CLAUDE_TIMEOUT_MS);
      });

      let output: string;
      try {
        output = await Promise.race([
          new Response(proc.stdout).text(),
          timeoutPromise,
        ]);
      } catch (err) {
        if (timedOut) {
          console.error(`Claude CLI timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`);
          return "Claude timed out after 5 minutes. Please try again.";
        }
        throw err;
      } finally {
        clearTimeout(timeoutTimer!);
      }

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        console.error("Claude error:", stderr);
        return `Error: ${stderr || "Claude exited with code " + exitCode}`;
      }

      // Parse JSON response
      try {
        const result = JSON.parse(output);

        // Extract and save session ID for resumption (skip for internal calls)
        if (result.session_id && !options?.internal) {
          session.sessionId = result.session_id;
          session.lastActivity = new Date().toISOString();
          await saveSession(session);
          console.log(`Session saved: ${result.session_id}`);
        }

        // Return the actual response text
        return result.result || "No response";
      } catch (parseError) {
        console.error("Failed to parse JSON output:", parseError);
        // Fallback to raw output if JSON parsing fails
        return output.trim();
      }
    } finally {
      await unregisterChildPid(pid);
    }
  } catch (error) {
    console.error("Spawn error:", error);
    return `Error: Could not run Claude CLI`;
  }
}

// ============================================================
// AUDIT LOGGING
// ============================================================

interface AuditLogEntry {
  timestamp: string;
  prompt: string;
  sessionId: string | null;
  workingDir: string;
  autonomousMode: boolean;
}

async function auditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const logFile = join(AUDIT_LOG_DIR, `audit-${new Date().toISOString().split('T')[0]}.json`);
    await writeFile(logFile, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch (error) {
    console.error("Audit log error:", error);
  }
}

// ============================================================
// PER-USER CONCURRENCY
// ============================================================

const activeRequests = new Map<string, boolean>();

function isUserBusy(userId: string | undefined): boolean {
  return !!userId && activeRequests.get(userId) === true;
}

function markUserBusy(userId: string | undefined): void {
  if (userId) activeRequests.set(userId, true);
}

function markUserFree(userId: string | undefined): void {
  if (userId) activeRequests.delete(userId);
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

// /new — manually close session
bot.command("new", async (ctx) => {
  const { messageCount } = await closeSession("manual");
  if (messageCount > 0) {
    await ctx.reply(`Session closed (${messageCount} messages). Starting fresh.`);
  } else {
    await ctx.reply("No active session to close.");
  }
});

// /status — show session info
bot.command("status", async (ctx) => {
  const age = session.startedAt
    ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000)
    : 0;
  const idle = Math.round((Date.now() - new Date(session.lastActivity).getTime()) / 60000);
  const participants = session.userIds
    .map(id => getUserRole(id)?.name || id)
    .join(", ") || "none";
  const sid = session.sessionId ? session.sessionId.substring(0, 12) + "..." : "none";

  let status = `<b>Session Status</b>\n`;
  status += `ID: <code>${sid}</code>\n`;
  status += `Messages: ${session.messageCount}/${SESSION_MAX_MESSAGES}\n`;
  status += `Age: ${age} min\n`;
  status += `Idle: ${idle} min (timeout: ${SESSION_IDLE_TIMEOUT_MIN} min)\n`;
  status += `Participants: ${participants}\n`;
  status += `Supabase: ${supabase ? "connected" : "not configured"}`;

  await ctx.reply(status, { parse_mode: "HTML" });
});

// Text messages
bot.on("message:text", async (ctx) => {
  if (isGroupChat(ctx) && !shouldRespondInGroup(ctx)) return;

  let text = ctx.message.text;
  const userId = ctx.from?.id.toString();
  console.log(`Message from ${getUserRole(userId)?.name || userId}: ${text.substring(0, 50)}...`);

  if (isGroupChat(ctx)) {
    text = stripBotMention(text, ctx.me.username);
    if (!text) return; // message was only the @mention with no prompt
  }

  if (isUserBusy(userId)) {
    await ctx.reply("I'm still working on your previous request. Please wait.");
    return;
  }

  markUserBusy(userId);

  // Fire-and-forget: unblocks the polling loop so other users' messages are processed
  void (async () => {
    await ctx.replyWithChatAction("typing");
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      const userName = getUserRole(userId)?.name || "User";
      const chatId = ctx.chat.id.toString();
      await trackMessage(text, userName, userId!, chatId);
      const enrichedPrompt = await buildPrompt(text, userId, chatId);
      const response = await callClaude(enrichedPrompt, { resume: true, userId });
      await trackResponse(response);
      await sendResponse(ctx, response);
    } catch (error) {
      console.error("Text handler error:", error);
      await ctx.reply("Something went wrong processing your message.").catch(() => {});
    } finally {
      clearInterval(typingInterval);
      markUserFree(userId);
    }
  })();
});

// Voice messages (optional - requires transcription)
bot.on("message:voice", async (ctx) => {
  if (isGroupChat(ctx) && !shouldRespondInGroup(ctx)) return;

  console.log("Voice message received");
  await ctx.replyWithChatAction("typing");

  // To handle voice, you need a transcription service
  // Options: Whisper API, Gemini, AssemblyAI, etc.
  //
  // Example flow:
  // 1. Download the voice file
  // 2. Send to transcription service
  // 3. Pass transcription to Claude
  //
  // const transcription = await transcribe(voiceFile);
  // const response = await callClaude(`[Voice]: ${transcription}`);

  await ctx.reply(
    "Voice messages require a transcription service. " +
      "Add Whisper, Gemini, or similar to handle voice."
  );
});

// Photos/Images
bot.on("message:photo", async (ctx) => {
  if (isGroupChat(ctx) && !shouldRespondInGroup(ctx)) return;

  const userId = ctx.from?.id.toString();
  console.log(`Image from ${getUserRole(userId)?.name || userId}`);

  if (isUserBusy(userId)) {
    await ctx.reply("I'm still working on your previous request. Please wait.");
    return;
  }

  markUserBusy(userId);

  void (async () => {
    await ctx.replyWithChatAction("typing");
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      // Get highest resolution photo
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1];
      const file = await ctx.api.getFile(photo.file_id);

      // Download the image
      const timestamp = Date.now();
      const filePath = join(UPLOADS_DIR, `image_${timestamp}.jpg`);

      const response = await fetch(
        `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
      );
      const buffer = await response.arrayBuffer();
      await writeFile(filePath, Buffer.from(buffer));

      // Claude Code can see images via file path
      let caption = ctx.message.caption || "Analyze this image.";
      if (isGroupChat(ctx) && ctx.message.caption) {
        caption = stripBotMention(caption, ctx.me.username);
        if (!caption) caption = "Analyze this image.";
      }
      const userName = getUserRole(userId)?.name || "User";
      const chatId = ctx.chat.id.toString();
      const messageText = `[Image] ${caption}`;
      await trackMessage(messageText, userName, userId!, chatId);
      const prompt = await buildPrompt(`[Image: ${filePath}]\n\n${caption}`, userId, chatId);

      const claudeResponse = await callClaude(prompt, { resume: true, userId });
      await trackResponse(claudeResponse);

      // Cleanup after processing
      await unlink(filePath).catch(() => {});

      await sendResponse(ctx, claudeResponse);
    } catch (error) {
      console.error("Image error:", error);
      await ctx.reply("Could not process image.").catch(() => {});
    } finally {
      clearInterval(typingInterval);
      markUserFree(userId);
    }
  })();
});

// Documents
bot.on("message:document", async (ctx) => {
  if (isGroupChat(ctx) && !shouldRespondInGroup(ctx)) return;

  const doc = ctx.message.document;
  const userId = ctx.from?.id.toString();
  console.log(`Document from ${getUserRole(userId)?.name || userId}: ${doc.file_name}`);

  if (isUserBusy(userId)) {
    await ctx.reply("I'm still working on your previous request. Please wait.");
    return;
  }

  markUserBusy(userId);

  void (async () => {
    await ctx.replyWithChatAction("typing");
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      const file = await ctx.getFile();
      const timestamp = Date.now();
      const fileName = doc.file_name || `file_${timestamp}`;
      const filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);

      const response = await fetch(
        `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
      );
      const buffer = await response.arrayBuffer();
      await writeFile(filePath, Buffer.from(buffer));

      let caption = ctx.message.caption || `Analyze: ${doc.file_name}`;
      if (isGroupChat(ctx) && ctx.message.caption) {
        caption = stripBotMention(caption, ctx.me.username);
        if (!caption) caption = `Analyze: ${doc.file_name}`;
      }
      const userName = getUserRole(userId)?.name || "User";
      const chatId = ctx.chat.id.toString();
      const messageText = `[File: ${doc.file_name}] ${caption}`;
      await trackMessage(messageText, userName, userId!, chatId);
      const prompt = await buildPrompt(`[File: ${filePath}]\n\n${caption}`, userId, chatId);

      const claudeResponse = await callClaude(prompt, { resume: true, userId });
      await trackResponse(claudeResponse);

      await unlink(filePath).catch(() => {});

      await sendResponse(ctx, claudeResponse);
    } catch (error) {
      console.error("Document error:", error);
      await ctx.reply("Could not process document.").catch(() => {});
    } finally {
      clearInterval(typingInterval);
      markUserFree(userId);
    }
  })();
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert Markdown to Telegram-supported HTML.
 * Handles: code blocks, inline code, bold, italic, links.
 * Escapes HTML entities first to avoid injection issues.
 */
function markdownToTelegramHTML(text: string): string {
  // Step 1: Extract fenced code blocks and inline code so they aren't
  // affected by later transformations. We replace them with placeholders
  // and restore after all other conversions.
  const placeholders: string[] = [];
  function placeholder(content: string): string {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\x00PH${idx}\x00`;
  }

  // Escape HTML entities in the raw text first
  let result = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks: ```lang\ncode\n```
  result = result.replace(/```(?:\w*)\n([\s\S]*?)```/g, (_match, code) => {
    return placeholder(`<pre>${code.replace(/\n$/, "")}</pre>`);
  });

  // Inline code: `code`
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    return placeholder(`<code>${code}</code>`);
  });

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* (but not inside words like file*name)
  result = result.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore placeholders
  result = result.replace(/\x00PH(\d+)\x00/g, (_match, idx) => {
    return placeholders[parseInt(idx)];
  });

  return result;
}

async function getRecentSummaries(chatId: string | null): Promise<string[]> {
  if (!supabase || !chatId || SESSION_MEMORY_COUNT <= 0) return [];
  try {
    const result = await Promise.race([
      supabase.from("telegram_sessions")
        .select("summary")
        .eq("chat_id", chatId)
        .not("summary", "is", null)
        .order("closed_at", { ascending: false })
        .limit(SESSION_MEMORY_COUNT),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    const { data, error } = result as { data: { summary: string }[] | null; error: any };
    if (error || !data) return [];
    return data.map(r => r.summary).filter(Boolean);
  } catch {
    return [];
  }
}

async function buildPrompt(userMessage: string, userId?: string, chatId?: string): Promise<string> {
  // Add context to every prompt
  // Customize this for your use case

  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let contextInfo = `
You are responding via Telegram. Keep responses concise.

Current time: ${timeStr}`;

  // Inject recent session summaries for continuity
  const summaries = await getRecentSummaries(chatId || session.chatId);
  if (summaries.length > 0) {
    contextInfo += `\n\nPREVIOUS SESSION CONTEXT (${summaries.length} recent session${summaries.length > 1 ? "s" : ""}):`;
    summaries.forEach((s, i) => {
      contextInfo += `\n${i + 1}. ${s}`;
    });
    contextInfo += `\n(Use this for continuity. Don't reference unless relevant.)`;
  }

  if (AUTONOMOUS_MODE) {
    contextInfo += `

AUTONOMOUS MODE ACTIVE:
- You are operating in autonomous mode with full permissions
- Working directory: ${CLAUDE_WORKING_DIR}
- You can execute commands without asking for permission
- IMPORTANT: You are restricted to working ONLY within ${CLAUDE_WORKING_DIR}
- Do NOT access files or directories outside this scope
- All file operations must be within this directory

AVAILABLE TOOLS:
- GitHub CLI (gh) is installed. Use it for PRs, issues, and repo operations.

DEPLOYMENT WORKFLOW:
This project has TWO deployment targets:

1. FRONTEND (Netlify) — Triggered automatically by git push to main
   - Changes to: src/, index.html, public/, vite.config.ts, tailwind config
   - Just commit and push — Netlify handles the rest

2. BACKEND (Convex) — Must be explicitly deployed
   - Changes to: any files inside convex/ (schema.ts, functions, auth, etc.)
   - Run: npx convex deploy --yes
   - The deploy key is already in the environment — do NOT pass it manually
   - The --yes flag skips the interactive confirmation prompt

WHEN BOTH change:
  a. Run npx convex deploy --yes first (backend)
  b. If it succeeds, then git add, commit, push (frontend)
  c. If convex deploy fails, fix the error and retry — do NOT push broken frontend

IF convex deploy FAILS:
  - Read the error carefully (TypeScript errors, schema issues, etc.)
  - Fix the issue, then retry: npx convex deploy --yes
  - Report what failed and what you fixed`;
  }

  const role = getUserRole(userId);
  if (role?.systemPrompt) {
    contextInfo += `\n\n${role.systemPrompt}`;
  }

  return `${contextInfo}

User: ${userMessage}
`.trim();
}

async function sendResponse(ctx: Context, response: string): Promise<void> {
  // Telegram has a 4096 character limit
  const MAX_LENGTH = 4000;

  const htmlResponse = markdownToTelegramHTML(response);

  // Split long responses (use the HTML version for length check)
  const chunks: string[] = [];
  let remaining = htmlResponse;

  if (remaining.length <= MAX_LENGTH) {
    chunks.push(remaining);
  } else {
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a natural boundary
      let splitIndex = remaining.lastIndexOf("\n\n", MAX_LENGTH);
      if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitIndex === -1) splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
      if (splitIndex === -1) splitIndex = MAX_LENGTH;

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }
  }

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    } catch (error) {
      // Fallback: if HTML parsing fails, send as plain text
      console.error("HTML parse_mode failed, falling back to plain text:", error);
      await ctx.reply(chunk);
    }
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

async function notifyUsers(message: string): Promise<void> {
  for (const userId of Object.keys(USER_ROLES)) {
    try {
      await bot.api.sendMessage(userId, message);
    } catch {
      // User may not have started a chat with the bot yet
    }
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Claude Telegram Relay...");
console.log(`Authorized users: ${Object.entries(USER_ROLES).map(([id, r]) => `${r.name} (${r.role})`).join(", ") || "ANY (not recommended)"}`);

bot.start({
  onStart: async () => {
    console.log("Bot is running!");
    await notifyUsers("Bot is online.");
  },
});
