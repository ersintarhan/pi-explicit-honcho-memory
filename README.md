# pi-explicit-honcho-memory

Explicit-load memory extension for [pi](https://pi.dev) using [Honcho](https://honcho.dev).

![NPM Version](https://img.shields.io/npm/v/%40ersintarhan%2Fpi-explicit-honcho-memory)

> [!NOTE]
> This repo is a fork of `@agney/pi-honcho-memory` and now implements an explicit `/load-memory` flow. Honcho memory is cached at session start, but it is only added to LLM context when you explicitly request it.

## Features

- **Explicit memory loading** — use `/load-memory` to add cached Honcho user/project memory to the conversation once
- **Refresh on demand** — use `/reload-memory` to fetch fresh Honcho context and generated session summaries, then replace the prior loaded memory block
- **No automatic prompt injection** — memory is not appended to the system prompt on every turn
- **Conversational persistence** — user/assistant messages saved to Honcho after each agent response
- **Flexible session strategies** — choose repo, git-branch, or directory scoped memory
- **LLM tools** — `honcho_search`, `honcho_chat`, `honcho_session_summary`, and `honcho_remember` for active memory operations
- **Graceful degradation** — pi works normally if Honcho is unavailable

## Install

```bash
pi install npm:@ersintarhan/pi-explicit-honcho-memory
```

Or try without installing:

```bash
pi -e npm:@ersintarhan/pi-explicit-honcho-memory
```

## Setup

1. Get an API key from [honcho.dev](https://honcho.dev)
2. Run `/honcho-setup` inside pi to configure interactively

Or set environment variables:

```bash
export HONCHO_API_KEY=hch-...
```

### Honcho agent skills

Honcho already ships its own installable agent skills. Install those separately from this pi extension with:

```bash
npx skills add plastic-labs/honcho
```

Docs: https://docs.honcho.dev/v3/documentation/introduction/vibecoding#agent-skills

### Configuration

Config is read from (highest priority first):

1. Environment variables: `HONCHO_API_KEY`, `HONCHO_URL`, `HONCHO_WORKSPACE_ID`, `HONCHO_PEER_NAME`, `HONCHO_AI_PEER`, `HONCHO_SESSION_STRATEGY`, `HONCHO_ENABLED`, `HONCHO_CONTEXT_TOKENS`, `HONCHO_MAX_MESSAGE_LENGTH`, `HONCHO_SEARCH_LIMIT`, `HONCHO_TOOL_PREVIEW_LENGTH`
2. Config file: `~/.honcho/config.json`

`HONCHO_SESSION_STRATEGY` / `hosts.pi.sessionStrategy` supports:

- `repo` — share memory across git worktrees of the same repo
- `git-branch` — keep separate memory per branch
- `directory` — keep separate memory per working directory

Config file properties (`~/.honcho/config.json`):

| Prop                         | Environment variable         | Description                                                            | Default            |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `apiKey`                     | `HONCHO_API_KEY`             | Honcho API key                                                         | none               |
| `peerName`                   | `HONCHO_PEER_NAME`           | User peer name                                                         | `$USER`            |
| `hosts.pi.workspace`         | `HONCHO_WORKSPACE_ID`        | Honcho workspace ID                                                    | `pi`               |
| `hosts.pi.aiPeer`            | `HONCHO_AI_PEER`             | AI peer name                                                           | `pi`               |
| `hosts.pi.endpoint`          | `HONCHO_URL`                 | Honcho API base URL                                                    | default Honcho API |
| `hosts.pi.sessionStrategy`   | `HONCHO_SESSION_STRATEGY`    | Session scope for memory sharing                                       | `repo`             |
| `hosts.pi.contextTokens`     | `HONCHO_CONTEXT_TOKENS`      | Token budget requested from Honcho when refreshing cached memory       | `1200`             |
| `hosts.pi.maxMessageLength`  | `HONCHO_MAX_MESSAGE_LENGTH`  | Maximum length of a synced user/assistant message before it is skipped | `8000`             |
| `hosts.pi.searchLimit`       | `HONCHO_SEARCH_LIMIT`        | Maximum number of search results returned by `honcho_search`           | `8`                |
| `hosts.pi.toolPreviewLength` | `HONCHO_TOOL_PREVIEW_LENGTH` | Head/tail preview length per search result returned by `honcho_search` | `400`              |

All numeric options must be positive integers. Invalid values fall back to defaults.

## Tools

| Tool              | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `honcho_search`          | Search persistent memory for prior conversations and decisions |
| `honcho_chat`            | Ask Honcho to reason over memory for deeper questions          |
| `honcho_session_summary` | Fetch the generated summary for the current or a specific session |
| `honcho_remember`        | Save a durable fact, preference, or decision                   |

By default, `honcho_search` and `honcho_chat` are current-session scoped.

Both tools also accept:
- `global?: boolean` — when `true`, query broader workspace/global memory instead of the current session
- `sessionId?: string` — when provided, query that exact Honcho session

`sessionId` takes precedence over `global`.

Examples:

```json
{ "query": "What do you know about my preferences?", "global": true }
```

```json
{ "query": "MemU'nun .NET'e portundaki zorluklar nelerdir?", "sessionId": "repo_NevaMind-AI_memU", "reasoningLevel": "low" }
```

## Commands

| Command          | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `/honcho-status` | Show connection status, cache info, and whether memory is loaded   |
| `/honcho-setup`  | Interactive configuration wizard                                   |
| `/load-memory`   | Load cached Honcho user/project memory into the current session    |
| `/reload-memory` | Refresh Honcho memory and replace the loaded conversation block    |

## Workflow

1. Start pi with the extension enabled.
2. Honcho connection and cache warm-up happen in the background.
3. When you actually want memory in-context, run:

```bash
/load-memory
```

4. If the underlying Honcho memory changed, run:

```bash
/reload-memory
```

5. Use `honcho_search`, `honcho_chat`, `honcho_session_summary`, and `honcho_remember` for deeper or explicit memory operations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
