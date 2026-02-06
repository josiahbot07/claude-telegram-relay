# Quick Start - Autonomous Mode

## Current Status

✅ All code changes implemented and committed
✅ Configuration validated
⚠️  Manual relay process currently running (PID: 3236)
⏳ Ready to install as 24/7 daemon

## Installation (One-Time Setup)

```bash
cd /Users/motbot/workspace/claude-telegram-relay

# Stop any existing relay process
ps aux | grep "bun.*relay" | grep -v grep | awk '{print $2}' | xargs kill

# Install as daemon
bash scripts/install-daemon.sh
```

That's it! The relay will now run 24/7 with autonomous mode active.

## Daily Usage

Just send messages to your Telegram bot. Claude will:
- Respond automatically (no permission prompts)
- Work only within `/Users/motbot/workspace/auto-injury-assistance`
- Log all actions to audit trail
- Maintain session continuity across restarts

## Management Commands

```bash
# Check status
launchctl list | grep claude

# View logs
tail -f ~/Library/Logs/claude-telegram-relay.log

# Restart
bash scripts/restart-daemon.sh

# Stop
bash scripts/uninstall-daemon.sh
```

## Test Commands (via Telegram)

Send these to verify autonomous mode:

1. **"What's the current working directory?"**
   Should report: `/Users/motbot/workspace/auto-injury-assistance`

2. **"List files in this directory"**
   Should show auto-injury-assistance contents

3. **"Create a test file called hello.txt with 'test' inside"**
   Should create without asking permission

4. **"What's in /etc/hosts?"**
   Should fail or refuse (directory restriction test)

## Audit Trail

All Claude invocations are logged:

```bash
# Today's audit log
cat ~/.claude-relay/audit/audit-$(date +%Y-%m-%d).json | jq

# Watch live
tail -f ~/.claude-relay/audit/audit-$(date +%Y-%m-%d).json
```

## Safety Features Active

✓ Working directory locked to auto-injury-assistance
✓ Permission mode: dontAsk (autonomous but bounded)
✓ Multi-layer directory restrictions (cwd + flags + env vars)
✓ Complete audit logging
✓ Session continuity with crash recovery

## What Changed

- **src/relay.ts**: Added autonomous mode with directory restrictions
- **daemon/launchagent.plist**: Configured for user motbot with autonomous env vars
- **.env**: Set AUTONOMOUS_MODE=true and target directory
- **scripts/**: Management automation (install, restart, uninstall, test)

## See Also

- `AUTONOMOUS_SETUP.md` - Complete implementation details
- `scripts/test-config.sh` - Validate configuration
- `README.md` - Original relay documentation
