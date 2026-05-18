/* eslint-disable no-magic-numbers */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises"; // eslint-disable-line import/no-nodejs-modules
import { dirname } from "node:path"; // eslint-disable-line import/no-nodejs-modules
import { bootstrap, clearHandles, getHandles } from "./client.js";
import {
  getConfigPath,
  getSessionStrategyLabel,
  normalizeSessionStrategy,
  readConfigFile,
  resolveConfig,
} from "./config.js";
import {
  buildExplicitMemoryMessage,
  getCachedMemory,
  getCachedMemoryParts,
  LOADED_MEMORY_CUSTOM_TYPE,
  refreshMemoryCache,
} from "./memory.js";

const MASKED_KEY = "••••••••";
const JSON_INDENT = 2;

interface LoadedMemoryDetailsLike {
  loadedAt?: string;
  source?: "load-memory" | "reload-memory";
  chars?: number;
}

interface SessionEntryLike {
  type?: string;
  customType?: string;
  details?: LoadedMemoryDetailsLike;
}

interface SessionManagerLike {
  getEntries: () => SessionEntryLike[];
  getBranch: () => SessionEntryLike[];
}

// --- Helpers ---

const errorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
};

const enabledLabel = (flag: boolean): string => {
  if (flag) {
    return "✅ yes";
  }
  return "❌ no";
};

const memoryCacheLabel = (cached: string | null): string => {
  if (cached) {
    return `${cached.length} chars`;
  }
  return "empty";
};

const getLatestLoadedMemoryEntry = (entries: SessionEntryLike[]): SessionEntryLike | null => {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type === "custom_message" && entry.customType === LOADED_MEMORY_CUSTOM_TYPE) {
      return entry;
    }
  }
  return null;
};

const loadedMemoryLabel = (entry: SessionEntryLike | null): string => {
  if (!entry) {
    return "not loaded";
  }

  const source = entry.details?.source ?? "load-memory";
  const loadedAt = entry.details?.loadedAt;
  const chars = entry.details?.chars;
  const details = [chars ? `${chars} chars` : null, loadedAt ? loadedAt : null]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return details ? `${source} (${details})` : source;
};

const buildStatusLines = (
  config: Awaited<ReturnType<typeof resolveConfig>>,
  handles: ReturnType<typeof getHandles>,
  cached: string | null,
  loadedEntry: SessionEntryLike | null,
): string[] => {
  const lines: string[] = [];
  lines.push(`Enabled:      ${enabledLabel(config.enabled)}`);
  lines.push(`Connected:    ${enabledLabel(Boolean(handles))}`);
  lines.push(`Workspace:    ${config.workspaceId}`);
  lines.push(`User peer:    ${config.userPeerId}`);
  lines.push(`AI peer:      ${config.aiPeerId}`);
  lines.push(`Session mode: ${getSessionStrategyLabel(config.sessionStrategy)}`);
  lines.push(`Context toks: ${config.contextTokens}`);
  lines.push(`Msg max len:  ${config.maxMessageLength}`);
  lines.push(`Search limit: ${config.searchLimit}`);
  lines.push(`Tool preview: ${config.toolPreviewLength}`);

  if (handles) {
    lines.push(`Session key:  ${handles.sessionKey}`);
  }

  lines.push(`Memory cache: ${memoryCacheLabel(cached)}`);
  lines.push(`Memory load:  ${loadedMemoryLabel(loadedEntry)}`);

  if (config.baseURL) {
    lines.push(`Endpoint:     ${config.baseURL}`);
  }

  return lines;
};

const buildConfigFile = (
  fileContents: Record<string, unknown>,
  apiKey: string | null | undefined,
  peerName: string | null | undefined,
  endpoint: string | null | undefined,
  sessionStrategy: string | null | undefined,
  existing: Awaited<ReturnType<typeof resolveConfig>>,
): Record<string, unknown> => {
  const updated = { ...fileContents };

  if (apiKey && apiKey !== MASKED_KEY) {
    updated.apiKey = apiKey;
  }
  if (peerName) {
    updated.peerName = peerName;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const hosts = (
    typeof updated.hosts === "object" && updated.hosts !== null ? updated.hosts : {}
  ) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const piHost = (typeof hosts.pi === "object" && hosts.pi !== null ? hosts.pi : {}) as Record<
    string,
    unknown
  >;
  piHost.sessionStrategy = normalizeSessionStrategy(sessionStrategy || existing.sessionStrategy);
  if (endpoint) {
    piHost.endpoint = endpoint;
  }
  hosts.pi = piHost;
  updated.hosts = hosts;

  return updated;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const testConnection = async (pi: ExtensionAPI, ctx: { ui: any; cwd: string }): Promise<void> => {
  ctx.ui.notify("Testing connection...", "info");
  try {
    clearHandles();
    const newConfig = await resolveConfig();
    await bootstrap(pi, newConfig, ctx.cwd);
    ctx.ui.notify("✅ Connected to Honcho!", "info");
    ctx.ui.setStatus("honcho", ctx.ui.theme.fg("success", "🧠 Connected"));
  } catch (err) {
    ctx.ui.notify(`❌ Connection failed: ${errorMessage(err)}`, "error");
    ctx.ui.setStatus("honcho", ctx.ui.theme.fg("error", "🧠 Error"));
  }
};

const ensureIdle = (ctx: { isIdle: () => boolean; ui: { notify: (msg: string, level: string) => void } }): boolean => {
  if (ctx.isIdle()) {
    return true;
  }
  ctx.ui.notify("Wait until the agent is idle, then run this command again.", "warning");
  return false;
};

const loadMemoryIntoConversation = async (
  pi: ExtensionAPI,
  forceRefresh: boolean,
  source: "load-memory" | "reload-memory",
  ctx: {
    isIdle: () => boolean;
    sessionManager: SessionManagerLike;
    ui: { notify: (msg: string, level: string) => void };
  },
): Promise<void> => {
  if (!ensureIdle(ctx)) {
    return;
  }

  if (!forceRefresh && getLatestLoadedMemoryEntry(ctx.sessionManager.getBranch())) {
    ctx.ui.notify("Memory is already loaded for this branch. Use /reload-memory to refresh.", "info");
    return;
  }

  const handles = getHandles();
  if (!handles) {
    ctx.ui.notify("Honcho is not connected yet. Run /honcho-setup or wait for startup to finish.", "warning");
    return;
  }

  let refreshError: unknown;
  if (forceRefresh || !getCachedMemory()) {
    try {
      await refreshMemoryCache(handles);
    } catch (err) {
      refreshError = err;
    }
  }

  const message = buildExplicitMemoryMessage(getCachedMemoryParts(), source);
  if (!message) {
    if (refreshError) {
      ctx.ui.notify(`Failed to refresh Honcho memory: ${errorMessage(refreshError)}`, "error");
      return;
    }
    ctx.ui.notify("No Honcho memory was available to load.", "warning");
    return;
  }

  pi.sendMessage({
    customType: LOADED_MEMORY_CUSTOM_TYPE,
    content: message.content,
    display: true,
    details: message.details,
  });

  ctx.ui.notify(
    forceRefresh ? "Memory reloaded into the conversation." : "Memory loaded into the conversation.",
    "info",
  );
};

export const registerCommands = (pi: ExtensionAPI): void => {
  // --- /honcho-status ---
  pi.registerCommand("honcho-status", {
    description: "Show Honcho memory connection status",
    handler: async (_args, ctx) => {
      const config = await resolveConfig();
      const handles = getHandles();
      const cached = getCachedMemory();
      const loadedEntry = getLatestLoadedMemoryEntry(ctx.sessionManager.getBranch());
      const lines = buildStatusLines(config, handles, cached, loadedEntry);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // --- /load-memory ---
  pi.registerCommand("load-memory", {
    description: "Load Honcho user/project memory into the current conversation once",
    handler: async (_args, ctx) => {
      await loadMemoryIntoConversation(pi, false, "load-memory", ctx);
    },
  });

  // --- /reload-memory ---
  pi.registerCommand("reload-memory", {
    description: "Refresh Honcho memory and replace the loaded conversation memory block",
    handler: async (_args, ctx) => {
      await loadMemoryIntoConversation(pi, true, "reload-memory", ctx);
    },
  });

  // --- /honcho-setup ---
  pi.registerCommand("honcho-setup", {
    description: "Configure Honcho memory integration",
    handler: async (_args, ctx) => {
      const existing = await resolveConfig();

      const defaultKey = existing.apiKey ? MASKED_KEY : "hch-...";
      const apiKey = await ctx.ui.input("Honcho API key:", defaultKey);
      if (!apiKey || apiKey === MASKED_KEY) {
        if (!existing.apiKey) {
          ctx.ui.notify("API key is required.", "error");
          return;
        }
      }

      const peerName = await ctx.ui.input("Your peer name:", existing.userPeerId);
      const endpoint = await ctx.ui.input(
        "Honcho endpoint (leave blank for default):",
        existing.baseURL || "",
      );
      const sessionStrategyInput = await ctx.ui.input(
        "Session strategy (repo/git-branch/directory):",
        existing.sessionStrategy,
      );
      const sessionStrategy = normalizeSessionStrategy(
        sessionStrategyInput || existing.sessionStrategy,
      );

      if (
        sessionStrategyInput &&
        sessionStrategyInput !== sessionStrategy &&
        sessionStrategyInput !== existing.sessionStrategy
      ) {
        ctx.ui.notify(
          `Unknown session strategy '${sessionStrategyInput}'. Using ${sessionStrategy}.`,
          "warning",
        );
      }

      const configPath = getConfigPath();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const fileContents = ((await readConfigFile()) ?? {}) as Record<string, unknown>;
      const updated = buildConfigFile(
        fileContents,
        apiKey,
        peerName,
        endpoint,
        sessionStrategy,
        existing,
      );

      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, `${JSON.stringify(updated, null, JSON_INDENT)}\n`, "utf-8");

      ctx.ui.notify(`Config saved to ${configPath}`, "info");
      await testConnection(pi, ctx);
    },
  });
};
