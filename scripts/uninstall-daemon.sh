#!/bin/bash
#
# Uninstall Claude Telegram Relay daemon
#

set -e

PLIST_NAME="com.claude.telegram-relay.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "Uninstalling Claude Telegram Relay..."

if [ ! -f "$TARGET_PLIST" ]; then
    echo "Agent not installed (plist not found)"
    exit 0
fi

# Unload
echo "Stopping agent..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true

# Remove plist
echo "Removing plist..."
rm "$TARGET_PLIST"

echo "✓ Agent uninstalled successfully!"
echo ""
echo "Note: Session data and logs are preserved at:"
echo "  ~/.claude-relay/"
echo "  ~/Library/Logs/claude-telegram-relay.*"
echo ""
echo "To remove these as well, run:"
echo "  rm -rf ~/.claude-relay"
echo "  rm ~/Library/Logs/claude-telegram-relay.*"
