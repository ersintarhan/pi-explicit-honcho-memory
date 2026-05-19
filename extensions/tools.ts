/* eslint-disable no-magic-numbers */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import type { HonchoHandles } from "./client.js";
import { getHandles } from "./client.js"; // eslint-disable-line no-duplicate-imports

const ensureConnected = (): HonchoHandles => {
  const handles = getHandles();
  if (!handles) {
    throw new Error("Honcho is not connected. Run /honcho-setup to configure.");
  }
  return handles;
};

const formatPreview = (content: string, previewLength: number): string => {
  if (content.length <= previewLength * 2) {
    return content;
  }

  const head = content.slice(0, previewLength);
  const tail = content.slice(-previewLength);
  return `${head}\n…\n${tail}`;
};

const formatResults = (
  results: { peerId: string; content: string }[],
  previewLength: number,
): string =>
  results
    .map((mem, idx) => `${idx + 1}. [${mem.peerId}] ${formatPreview(mem.content, previewLength)}`)
    .join("\n\n");

// eslint-disable-next-line import/prefer-default-export
export const registerTools = (pi: ExtensionAPI): void => {
  // --- honcho_search ---
  pi.registerTool({
    name: "honcho_search",
    label: "Honcho Search",
    description:
      "Search persistent memory for prior conversations, decisions, and historical context",
    promptSnippet:
      "Search persistent memory for prior conversations, decisions, and historical context",
    promptGuidelines: [
      "Use honcho_search for factual recall of past conversations or decisions.",
      "Do not save secrets, tokens, or transient debugging details to Honcho.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      global: Type.Optional(
        Type.Boolean({
          description:
            "When true, search broader workspace memory instead of only the current session",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const handles = ensureConnected();

      const results = params.global === true
        ? await handles.honcho.search(params.query, {
            limit: handles.config.searchLimit,
          })
        : await handles.session.search(params.query, {
            limit: handles.config.searchLimit,
          });

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No relevant memory found for this query.",
            },
          ],
          details: {},
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatResults(results, handles.config.toolPreviewLength),
          },
        ],
        details: { count: results.length },
      };
    },
  });

  // --- honcho_chat ---
  pi.registerTool({
    name: "honcho_chat",
    label: "Honcho Chat",
    description:
      "Ask Honcho to reason over memory — for deeper questions about user preferences, patterns, and history",
    promptSnippet:
      "Reason over persistent memory for deeper questions about user preferences and patterns",
    promptGuidelines: ["Use honcho_chat for reasoning over memory, not simple lookup."],
    parameters: Type.Object({
      query: Type.String({ description: "Question to reason over" }),
      global: Type.Optional(
        Type.Boolean({
          description:
            "When true, reason over broader workspace memory instead of only the current session",
        }),
      ),
      // eslint-disable-next-line new-cap
      reasoningLevel: Type.Optional(
        StringEnum(["minimal", "low", "medium", "high", "max"] as const), // eslint-disable-line new-cap
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const handles = ensureConnected();

      const chatOptions: {
        target: HonchoHandles["userPeer"];
        session?: HonchoHandles["session"];
        reasoningLevel: string;
      } = {
        target: handles.userPeer,
        reasoningLevel: params.reasoningLevel ?? "low",
      };
      if (params.global !== true) {
        chatOptions.session = handles.session;
      }

      const result = await handles.aiPeer.chat(params.query, chatOptions);

      if (result === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No relevant memory found for this query.",
            },
          ],
          details: {},
        };
      }

      return {
        content: [{ type: "text" as const, text: result }],
        details: {},
      };
    },
  });

  // --- honcho_remember ---
  pi.registerTool({
    name: "honcho_remember",
    label: "Honcho Remember",
    description: "Write an explicit durable fact, preference, or decision to persistent memory",
    promptSnippet: "Save a durable fact, preference, or decision to persistent memory",
    promptGuidelines: [
      "Use honcho_remember only for durable preferences, conventions, or decisions worth persisting.",
      "Do not save secrets, tokens, or transient debugging details to Honcho.",
    ],
    parameters: Type.Object({
      content: Type.String({
        description: "The fact, preference, or decision to remember",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const handles = ensureConnected();

      await handles.aiPeer.conclusionsOf(handles.userPeer).create({
        content: params.content,
        sessionId: handles.session,
      });

      return {
        content: [{ type: "text" as const, text: `Remembered: ${params.content}` }],
        details: {},
      };
    },
  });
};
