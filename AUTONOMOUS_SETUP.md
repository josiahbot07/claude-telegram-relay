# Autonomous Claude Telegram Relay Setup

## Status: IMPLEMENTED ✓

All code changes have been completed and committed. The relay is now configured for autonomous operation restricted to `/Users/motbot/workspace/auto-injury-assistance`.

## What Was Changed

### 1. Core Relay (`src/relay.ts`)
- Added `CLAUDE_WORKING_DIR`, `AUTONOMOUS_MODE`, and `AUDIT_LOG_DIR` configuration
- Modified `callClaude()` to:
  - Use `--permission-mode dontAsk` for autonomous operation
  - Restrict file access with `--add-dir` flag
  - Set working directory via `cwd` option
  - Pass directory restrictions via environment variables
- Added audit logging function to track all invocations
- Enhanced `buildPrompt()` to include autonomous mode context and restrictions
- Added startup validation to verify target directory exists

### 2. LaunchAgent Configuration (`daemon/launchagent.plist`)
- Updated all paths for user `motbot`
- Added environment variables:
  - `CLAUDE_WORKING_DIR=/Users/motbot/workspace/auto-injury-assistance`
  - `AUTONOMOUS_MODE=true`
  - `CLAUDE_PATH=/Users/motbot/.local/bin/claude`
- Configured log paths and auto-restart behavior

### 3. Environment Configuration (`.env`)
- Created with autonomous mode settings
- **IMPORTANT**: You must add your `TELEGRAM_BOT_TOKEN` before running

### 4. Management Scripts (`scripts/`)
- `install-daemon.sh` - Install and start the LaunchAgent
- `restart-daemon.sh` - Restart the daemon
- `uninstall-daemon.sh` - Stop and remove the daemon

## Next Steps

### Before You Begin

1. **Get Telegram Bot Token**:
   ```bash
   # 1. Message @BotFather on Telegram
   # 2. Send /newbot and follow prompts
   # 3. Copy the token
   ```

2. **Update .env file**:
   ```bash
   # Edit .env and replace <from BotFather> with your actual token
   nano .env
   ```

### Testing Locally (Recommended First)

Test before installing as a daemon:

```bash
cd /Users/motbot/workspace/claude-telegram-relay

# Make sure .env has your bot token
cat .env

# Run locally with autonomous mode
AUTONOMOUS_MODE=true \
CLAUDE_WORKING_DIR=/Users/motbot/workspace/auto-injury-assistance \
bun run src/relay.ts
```

**Test via Telegram**:
1. Send: "What's the current working directory?"
   - Expected: Should report `/Users/motbot/workspace/auto-injury-assistance`

2. Send: "List files in this directory"
   - Expected: Should show files from auto-injury-assistance

3. Send: "Create a file called test.txt with 'hello world'"
   - Expected: Should create without asking permission

4. Check audit log:
   ```bash
   cat ~/.claude-relay/audit/audit-$(date +%Y-%m-%d).json
   ```

### Installing as 24/7 Daemon

Once local testing works:

```bash
# Install and start
bash scripts/install-daemon.sh

# Verify it's running
launchctl list | grep claude

# View live logs
tail -f ~/Library/Logs/claude-telegram-relay.log
```

### Verification Tests

1. **Directory Restriction Test**:
   ```
   Telegram: "Read /etc/hosts"
   Expected: Should fail or refuse
   ```

2. **Autonomous Operation Test**:
   ```
   Telegram: "Create a test file"
   Expected: Creates without permission prompt
   ```

3. **Session Continuity Test**:
   ```
   Telegram: "Remember this number: 42"
   [Run: bash scripts/restart-daemon.sh]
   Telegram: "What number did I tell you?"
   Expected: "42" (session preserved)
   ```

4. **Crash Recovery Test**:
   ```bash
   # Kill the process
   killall -9 bun

   # Wait 10 seconds (auto-restart throttle)
   sleep 10

   # Send Telegram message - should respond
   ```

## Monitoring

**Check status**:
```bash
launchctl list | grep claude
```

**View logs**:
```bash
# Live stdout
tail -f ~/Library/Logs/claude-telegram-relay.log

# Live stderr
tail -f ~/Library/Logs/claude-telegram-relay.error.log

# Audit logs
tail -f ~/.claude-relay/audit/audit-$(date +%Y-%m-%d).json
```

**Restart**:
```bash
bash scripts/restart-daemon.sh
```

**Stop**:
```bash
bash scripts/uninstall-daemon.sh
```

## Safety Features

### Multi-Layer Directory Restriction
1. **Working directory**: Claude spawns with `cwd` set to target repo
2. **Permission flag**: `--add-dir` explicitly limits file system access
3. **Environment variable**: `CLAUDE_ALLOWED_DIR` set for awareness
4. **System prompt**: Cognitive boundary reinforcement in every message

### Audit Trail
- Daily JSON logs at `~/.claude-relay/audit/audit-YYYY-MM-DD.json`
- Includes: timestamp, prompt preview, session ID, working directory
- Permanent record of all autonomous actions

### Permission Mode
Using `--permission-mode dontAsk` instead of `--dangerously-skip-permissions`:
- Skips interactive prompts (enables autonomy)
- Respects directory boundaries (maintains safety)
- Still honors allow/deny lists

### Process Management
- Lock file prevents multiple instances
- LaunchAgent auto-restarts on crash (10s throttle)
- Graceful shutdown on SIGINT/SIGTERM
- Session continuity survives restarts

## Troubleshooting

**Bot not responding**:
```bash
# Check if running
launchctl list | grep claude

# Check logs for errors
tail -20 ~/Library/Logs/claude-telegram-relay.error.log

# Verify .env has bot token
grep TELEGRAM_BOT_TOKEN .env
```

**Permission denied errors**:
```bash
# Verify target directory exists
ls -la /Users/motbot/workspace/auto-injury-assistance

# Check Claude CLI is installed
which claude
claude --version
```

**Multiple instances**:
```bash
# The relay has a lock file to prevent this
# If lock is stale, remove it:
rm ~/.claude-relay/bot.lock

# Then restart
bash scripts/restart-daemon.sh
```

## Rollback

If you need to revert to non-autonomous mode:

```bash
# Stop the daemon
bash scripts/uninstall-daemon.sh

# Revert code changes
git reset --hard HEAD~1

# Test manually (non-autonomous)
bun run src/relay.ts
```

## Files Modified

- `src/relay.ts` - Core logic with autonomous mode support
- `daemon/launchagent.plist` - LaunchAgent configuration
- `.env` - Environment variables (contains sensitive token)
- `scripts/install-daemon.sh` - Installation script (new)
- `scripts/restart-daemon.sh` - Restart script (new)
- `scripts/uninstall-daemon.sh` - Uninstall script (new)

## Security Notes

- `.env` contains your bot token - DO NOT commit to git
- Only authorized Telegram user ID can interact with bot
- Claude operations restricted to single directory
- All actions logged to audit trail
- Using official Claude CLI (policy-compliant)

## Support

If you encounter issues:
1. Check the error logs: `tail ~/Library/Logs/claude-telegram-relay.error.log`
2. Verify all paths in `.env` and `daemon/launchagent.plist`
3. Test locally before using daemon mode
4. Check audit logs for what Claude is actually receiving
