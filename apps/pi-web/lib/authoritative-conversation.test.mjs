import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { applyAuthoritativeMessages } = await jiti.import("./authoritative-conversation.ts");

const idle = { isStreaming: false, streamingMessage: null };

test("authoritative stream overrides user metadata and Agent final answer", () => {
  const turns = [{
    id: "turn-2",
    user: { role: "user", content: "optimistic" },
    runs: [{ id: "run-2", agentId: "agent-a", messages: [], settled: true, stream: idle }],
  }];
  const messages = [
    { id: "message-turn-1", conversationId: "c", turnId: "turn-1", authorType: "member", authorId: "user", content: { role: "user", content: "root" }, createdAt: 1 },
    { id: "message-turn-2", conversationId: "c", turnId: "turn-2", authorType: "member", authorId: "user", replyToMessageId: "message-turn-1", content: { role: "user", content: "authoritative" }, createdAt: 2 },
    { id: "message-run-2", conversationId: "c", turnId: "turn-2", authorType: "agent", authorId: "agent-a", runId: "run-2", content: { role: "assistant", content: [{ type: "text", text: "final" }], model: "m", provider: "p" }, createdAt: 3 },
  ];

  const result = applyAuthoritativeMessages(turns, messages);
  assert.equal(result[0].user.content, "authoritative");
  assert.equal(result[0].user.replyToTurnId, "turn-1");
  assert.equal(result[0].user.replyToText, "root");
  assert.equal(result[0].runs[0].finalMessageId, "message-run-2");
  assert.equal(result[0].runs[0].finalMessage.content[0].text, "final");
});

test("unknown public messages do not erase live Run state", () => {
  const turns = [{
    id: "turn-1",
    user: { role: "user", content: "live" },
    runs: [{ id: "run-1", agentId: "agent-a", messages: [], settled: false, stream: { isStreaming: true, streamingMessage: null } }],
  }];
  const result = applyAuthoritativeMessages(turns, []);
  assert.equal(result[0].runs[0].settled, false);
  assert.equal(result[0].runs[0].stream.isStreaming, true);
});
