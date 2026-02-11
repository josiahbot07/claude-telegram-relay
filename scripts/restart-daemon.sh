#!/bin/bash
#
# Restart Claude Telegram Relay daemon
#

set -e

PLIST_NAME="com.claude.telegram-relay.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "Restarting Claude Telegram Relay..."

if [ ! -f "$TARGET_PLIST" ]; then
    echo "Error: Agent not installed. Run install-daemon.sh first."
    exit 1
fi

# Type check before restarting
echo "Running type check..."
cd "$(dirname "$0")/.."
if ! bun run check; then
    echo "✗ Type check failed. Fix errors before restarting."
    exit 1
fi
echo "✓ Type check passed."

# Unload
echo "Stopping agent..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true

# Wait a moment
sleep 1

# Load
echo "Starting agent..."
launchctl load "$TARGET_PLIST"

# Wait for startup
sleep 2

# Verify
if launchctl list | grep -q "claude.telegram-relay"; then
    echo "✓ Agent restarted successfully!"
    launchctl list | grep claude
else
    echo "✗ Agent failed to start. Check logs:"
    echo "  tail ~/Library/Logs/claude-telegram-relay.error.log"
    exit 1
fi
