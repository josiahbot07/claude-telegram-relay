#!/bin/bash
#
# Test the configuration before installing daemon
#

set -e

echo "Testing Claude Telegram Relay Configuration..."
echo ""

# Check required files
echo "1. Checking required files..."
if [ ! -f ".env" ]; then
    echo "   ✗ .env file not found"
    exit 1
fi
echo "   ✓ .env exists"

if [ ! -f "src/relay.ts" ]; then
    echo "   ✗ src/relay.ts not found"
    exit 1
fi
echo "   ✓ src/relay.ts exists"

# Load .env
source .env

# Check environment variables
echo ""
echo "2. Checking environment variables..."

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ "$TELEGRAM_BOT_TOKEN" = "<from BotFather>" ]; then
    echo "   ✗ TELEGRAM_BOT_TOKEN not set in .env"
    exit 1
fi
echo "   ✓ TELEGRAM_BOT_TOKEN set"

if [ -z "$TELEGRAM_USER_ID" ]; then
    echo "   ✗ TELEGRAM_USER_ID not set in .env"
    exit 1
fi
echo "   ✓ TELEGRAM_USER_ID set ($TELEGRAM_USER_ID)"

if [ "$AUTONOMOUS_MODE" = "true" ]; then
    echo "   ✓ AUTONOMOUS_MODE enabled"
else
    echo "   ⚠ AUTONOMOUS_MODE not enabled"
fi

if [ -n "$CLAUDE_WORKING_DIR" ]; then
    echo "   ✓ CLAUDE_WORKING_DIR set ($CLAUDE_WORKING_DIR)"
else
    echo "   ⚠ CLAUDE_WORKING_DIR not set"
fi

# Check Convex deploy key
if [ -n "$CONVEX_DEPLOY_KEY" ]; then
    echo "   ✓ CONVEX_DEPLOY_KEY set"
else
    echo "   ⚠ CONVEX_DEPLOY_KEY not set (Convex backend deploys won't work)"
fi

# Check target directory
echo ""
echo "3. Checking target directory..."
if [ ! -d "$CLAUDE_WORKING_DIR" ]; then
    echo "   ✗ Directory does not exist: $CLAUDE_WORKING_DIR"
    exit 1
fi
echo "   ✓ Directory exists: $CLAUDE_WORKING_DIR"

if [ ! -d "$CLAUDE_WORKING_DIR/.git" ]; then
    echo "   ⚠ Warning: Not a git repository"
else
    echo "   ✓ Git repository confirmed"
fi

if [ ! -d "$CLAUDE_WORKING_DIR/convex" ]; then
    echo "   ⚠ Warning: No convex/ directory found in target project"
else
    echo "   ✓ Convex directory found: $CLAUDE_WORKING_DIR/convex"
fi

# Check Claude CLI
echo ""
echo "4. Checking Claude CLI..."
CLAUDE_BIN="${CLAUDE_PATH:-claude}"
if ! command -v $CLAUDE_BIN &> /dev/null; then
    echo "   ✗ Claude CLI not found at: $CLAUDE_BIN"
    exit 1
fi
echo "   ✓ Claude CLI found: $(which $CLAUDE_BIN)"
echo "   ✓ Version: $(claude --version)"

# Check Bun
echo ""
echo "5. Checking Bun runtime..."
if [ ! -f "/Users/motbot/.bun/bin/bun" ]; then
    echo "   ✗ Bun not found at: /Users/motbot/.bun/bin/bun"
    exit 1
fi
echo "   ✓ Bun found: /Users/motbot/.bun/bin/bun"
echo "   ✓ Version: $(/Users/motbot/.bun/bin/bun --version)"

# Check for running instances
echo ""
echo "6. Checking for running instances..."
if ps aux | grep "bun.*relay" | grep -v grep > /dev/null; then
    echo "   ⚠ Relay process already running (PID: $(ps aux | grep 'bun.*relay' | grep -v grep | awk '{print $2}'))"
    echo "   Stop it before installing daemon: kill <PID>"
else
    echo "   ✓ No relay process running"
fi

if [ -f "$HOME/.claude-relay/bot.lock" ]; then
    echo "   ⚠ Lock file exists: ~/.claude-relay/bot.lock"
    LOCK_PID=$(cat "$HOME/.claude-relay/bot.lock" 2>/dev/null || echo "unknown")
    echo "   Lock PID: $LOCK_PID"
else
    echo "   ✓ No lock file found"
fi

echo ""
echo "✓ Configuration test passed!"
echo ""
echo "Next steps:"
if ps aux | grep "bun.*relay" | grep -v grep > /dev/null; then
    echo "  1. Stop the running relay process"
    echo "  2. Run: bash scripts/install-daemon.sh"
else
    echo "  1. Run: bash scripts/install-daemon.sh"
fi
