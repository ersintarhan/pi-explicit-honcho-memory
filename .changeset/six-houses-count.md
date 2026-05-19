---
"@ersintarhan/pi-explicit-honcho-memory": patch
---

Improve Honcho retrieval and summary loading.

- add `sessionId` support to `honcho_search` and `honcho_chat` for deterministic session-scoped recall
- add `honcho_session_summary` to fetch the generated summary for the current or a specific session
- load session summaries from the dedicated summaries endpoint during `/reload-memory`
- keep `honcho_search` previews in `400 head + 400 tail` format
- polish docs and GitHub/CI publishing setup
