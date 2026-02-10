# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram bot relay that spawns Claude CLI (`claude -p`) as a child process for each message. Built with Bun + grammy. Runs as a macOS LaunchAgent daemon.

## Commands

```bash
bun install              # Install dependencies
bun run src/relay.ts     # Run directly
bun run --watch src/relay.ts  # Dev mode with auto-reload (npm run dev)

npm run on               # Start as LaunchAgent daemon
npm run off              # Stop daemon
npm run restart          # Restart daemon (scripts/restart-daemon.sh)
```

**Logs:** `~/Library/Logs/claude-telegram-relay.log` and `.error.log`

## Architecture

Single-file bot in `src/relay.ts` (~1090 lines). No build step — Bun runs TypeScript directly.

### Message Flow
1. Grammy bot receives Telegram message (text, photo, or document)
2. Auth middleware checks user ID against `ALLOWED_USER_IDS`
3. Per-user concurrency lock prevents parallel requests from same user
4. `buildPrompt()` enriches message with context (time, session summaries, autonomous mode instructions, per-user role/system prompt)
5. `callClaude()` spawns `claude -p <prompt> --output-format json` as child process
6. JSON response parsed and returned (rolling window of recent exchanges provides continuity)
7. Response converted from Markdown to Telegram HTML, chunked at 4000 chars, sent back

### Key Design Decisions
- **Fire-and-forget handlers**: Message handlers use `void (async () => {...})()` to unblock the grammy polling loop so multiple users' messages are processed concurrently
- **5-minute timeout** (`CLAUDE_TIMEOUT_MS`): Claude CLI can hang indefinitely — timeout with SIGTERM escalating to SIGKILL is critical
- **Lock file** (`~/.claude-relay/bot.lock`): Prevents multiple bot instances from running simultaneously
- **Child PID tracking** (`children.json`): Orphaned Claude processes from previous runs are cleaned up on startup
- **Session lifecycle**: Auto-closes after `SESSION_MAX_MESSAGES` (default 15) messages or `SESSION_IDLE_TIMEOUT_MIN` (default 15) minutes idle. Transcripts persisted to Supabase (optional) with AI-generated summaries. In-session continuity via rolling window (`ROLLING_WINDOW_PAIRS` recent exchanges injected into each prompt)

### User Roles
Hardcoded in `USER_ROLES` record. Each user gets a role (`owner`/`pm`), allowed tools list, and optional system prompt. The `pm` role is restricted to small changes with a deployment workflow baked into the system prompt.

### Autonomous Mode
When `AUTONOMOUS_MODE=true`, Claude CLI runs with `--permission-mode dontAsk` and `--add-dir` pointing to `CLAUDE_WORKING_DIR`. The working directory for autonomous operations is separate from this repo (defaults to `/Users/motbot/workspace/family-built`).

## Environment

Config via `.env` file (see `.env.example`). Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`. Optional: Supabase for session persistence, session lifecycle tuning.

## File Layout

- `src/relay.ts` — Entire bot implementation
- `scripts/` — Daemon management (install, restart, uninstall, test-config)
- `daemon/` — LaunchAgent plist and systemd service templates
- `examples/` — Standalone patterns (morning briefing, smart check-in, memory persistence, Supabase schema)
