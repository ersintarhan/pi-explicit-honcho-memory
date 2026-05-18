import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bootstrap, clearHandles, getHandles } from "./client.js";
import { registerCommands } from "./commands.js";
import { resolveConfig } from "./config.js";
import {
  clearCachedMemory,
  flushPending,
  LOADED_MEMORY_CUSTOM_TYPE,
  refreshMemoryCache,
  saveMessages,
} from "./memory.js";
import { registerTools } from "./tools.js";

interface StatusContext {
  ui: {
    setStatus: (id: string, text: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    theme: any;
  };
}

interface CustomMessageLike {
  customType?: string;
}

const setStatus = (
  ctx: StatusContext,
  state: "off" | "connected" | "syncing" | "offline" | "error",
): void => {
  const { theme } = ctx.ui;
  const labels: Record<string, string> = {
    off: theme.fg("dim", "🧠 Honcho off"),
    connected: theme.fg("success", "🧠 Connected"),
    syncing: theme.fg("warning", "🧠 Syncing"),
    offline: theme.fg("dim", "🧠 Offline"),
    error: theme.fg("error", "🧠 Error"),
  };
  ctx.ui.setStatus("honcho", labels[state]);
};

export default function honcho(pi: ExtensionAPI): void {
  registerTools(pi);
  registerCommands(pi);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const backgroundInit = (ctx: { ui: any; cwd: string }): void => {
    void (async () => {
      try {
        const config = await resolveConfig();
        if (!config.enabled || !config.apiKey) {
          setStatus(ctx, "off");
          return;
        }

        const handles = await bootstrap(pi, config, ctx.cwd);
        setStatus(ctx, "connected");
        try {
          await refreshMemoryCache(handles);
        } catch {
          // Connection succeeded; treat cache warm-up failure as non-fatal.
        }
      } catch {
        setStatus(ctx, "offline");
      }
    })();
  };

  pi.on("session_start", (_event, ctx) => {
    clearHandles();
    clearCachedMemory();
    backgroundInit(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await flushPending();
    clearHandles();
    clearCachedMemory();
    backgroundInit(ctx);
  });

  pi.on("session_fork", async (_event, ctx) => {
    await flushPending();
    clearHandles();
    clearCachedMemory();
    backgroundInit(ctx);
  });

  // Keep only the latest explicit memory block in future LLM context.
  pi.on("context", async (event) => {
    let lastIndex = -1;
    for (let i = 0; i < event.messages.length; i += 1) {
      const message = event.messages[i] as CustomMessageLike;
      if (message.customType === LOADED_MEMORY_CUSTOM_TYPE) {
        lastIndex = i;
      }
    }

    if (lastIndex === -1) {
      return;
    }

    return {
      messages: event.messages.filter((message, index) => {
        const custom = message as CustomMessageLike;
        return custom.customType !== LOADED_MEMORY_CUSTOM_TYPE || index === lastIndex;
      }),
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    const handles = getHandles();
    if (!handles) {
      return;
    }

    setStatus(ctx, "syncing");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion
    saveMessages(handles, event.messages as any[])
      .then(() => setStatus(ctx, "connected"))
      .catch(() => setStatus(ctx, "offline"));
  });

  pi.on("session_before_compact", async () => {
    await flushPending();
  });

  pi.on("session_before_switch", async () => {
    await flushPending();
  });

  pi.on("session_before_fork", async () => {
    await flushPending();
  });

  pi.on("session_shutdown", async () => {
    await flushPending();
  });
}
