# Token Usage Analysis - Session ce89ef55

Analyzed on 2026-02-09. Session ran Feb 7 - Feb 10.

## Raw Numbers
- 232 user messages from Telegram (151 PM, 81 owner)
- 2142 API calls (includes tool use streaming)
- 1228 tool result messages
- Session JSONL file: 17MB, 3846 lines

## Context Growth
| Metric | First 50 calls | Last 50 calls |
|--------|----------------|---------------|
| Avg context | 36,572 tokens | 150,302 tokens |

Growth factor: 4.1x over 232 user messages.

## Cost Breakdown (Opus Pricing)
| Category | Tokens | Rate ($/M) | Cost |
|----------|--------|-----------|------|
| Input (non-cached) | 7,467 | $15.00 | $0.11 |
| Cache write | 15,108,102 | $18.75 | $283.28 |
| Cache read | 212,562,139 | $1.50 | $318.84 |
| Output | 14,491 | $75.00 | $1.09 |
| **TOTAL** | | | **$603.32** |

Without any caching: $3,416.25 (caching already saves ~82%)

## Key Observations
1. Cache reads are the dominant cost driver ($318.84)
2. Cache writes are also large ($283.28) because tool-use heavy sessions create lots of new cache blocks
3. Output tokens are negligible ($1.09) -- bot responses are short
4. The problem is not "no caching" -- caching works. The problem is the context window growing to 160K tokens and never shrinking.
5. Clearing sessions periodically would reset context to ~26K (system prompt + working dir context) instead of 160K.

## Projected Savings from Session Clearing
If sessions were cleared every 30 messages:
- Max context: ~50K tokens instead of 160K
- Avg context: ~35K instead of ~90K
- Rough estimate: 50-60% reduction in cache read costs
- Savings: ~$150-200 over the same 3-day period
