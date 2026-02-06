#!/bin/bash
#
# Install Claude Telegram Relay as macOS LaunchAgent
#

set -e

PLIST_NAME="com.claude.telegram-relay.plist"
SOURCE_PLIST="daemon/launchagent.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

echo "Installing Claude Telegram Relay as LaunchAgent..."

# Check source plist exists
if [ ! -f "$SOURCE_PLIST" ]; then
    echo "Error: $SOURCE_PLIST not found"
    exit 1
fi

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Unload existing agent if present
if launchctl list | grep -q "claude.telegram-relay"; then
    echo "Unloading existing agent..."
    launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

# Copy plist
echo "Copying plist to $TARGET_PLIST..."
cp "$SOURCE_PLIST" "$TARGET_PLIST"

# Load the agent
echo "Loading agent..."
launchctl load "$TARGET_PLIST"

# Wait a moment for it to start
sleep 2

# Verify it's running
if launchctl list | grep -q "claude.telegram-relay"; then
    echo "✓ Agent installed and running!"
    echo ""
    echo "Status:"
    launchctl list | grep claude
    echo ""
    echo "Logs:"
    echo "  stdout: ~/Library/Logs/claude-telegram-relay.log"
    echo "  stderr: ~/Library/Logs/claude-telegram-relay.error.log"
    echo "  audit:  ~/.claude-relay/audit/"
    echo ""
    echo "To view live logs:"
    echo "  tail -f ~/Library/Logs/claude-telegram-relay.log"
else
    echo "✗ Agent failed to start. Check error log:"
    echo "  tail ~/Library/Logs/claude-telegram-relay.error.log"
    exit 1
fi
