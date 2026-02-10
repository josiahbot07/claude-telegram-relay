# Staff Engineer Reviewer - Memory

## Architecture
- Main bot: `/Users/motbot/workspace/claude-telegram-relay/src/relay.ts`
- Session file: `/Users/motbot/.claude-relay/session.json` (single global session)
- Claude CLI sessions stored in: `/Users/motbot/.claude/projects/-Users-motbot-workspace-family-built/`
- Session transcripts are JSONL files containing all messages, tool uses, and tool results
- Memory example: `/Users/motbot/workspace/claude-telegram-relay/examples/memory.ts`

## Token Usage Analysis (2026-02-09)
See `token-analysis.md` for full details. Key findings:
- Single session ce89ef55 grew to 162K context tokens over 232 user messages (3 days)
- 2142 API calls total; context grew 4.1x from first 50 to last 50 calls
- Cache read dominates: 212M tokens read vs 15M written
- Total estimated cost: ~$603 over 3 days for one session
- Cache reads at $1.50/M are 10x cheaper than full input at $15/M
- The caching is ALREADY saving significant money vs. no caching
- BUT context still grows unbounded -- 150K tokens per call at the end

## Key Insight: Per-User Sessions Won't Save Much
- 151/232 messages came from PM (Rocky), 81 from owner (Mot)
- Even split by user, Rocky alone would reach ~100K context
- The real problem is unbounded session growth, not user mixing
- Auto-clear on idle/message-count is the high-leverage fix

## User Roles
- Mot (owner, ID: 8493500703) - full tool access
- Rocky (PM, ID: 8253689321) - limited tools, has deployment workflow system prompt
