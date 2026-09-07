import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mergeGroupConversationTurns } = await jiti.import("./group-conversation-state.ts");

const idle = { isStreaming: false, streamingMessage: null };
const live = {
  isStreaming: true,
  streamingMessage: { role: "assistant", content: [{ type: "text", text: "partial" }] },
};
const user = { role: "user", content: "hello", timestamp: 1 };
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: 2 });

function turn(id, run) {
  return { id, user, runs: [run] };
}

function run(overrides = {}) {
  return { id: "run-1", agentId: "agent-1", messages: [], stream: idle, settled: false, ...overrides };
}

test("reconnect snapshot settles a live run and replaces its stream", () => {
  const current = [turn("turn-1", run({ stream: live }))];
  const stored = [turn("turn-1", run({ messages: [assistant("done")], settled: true }))];

  const merged = mergeGroupConversationTurns(current, stored);
  assert.equal(merged[0].runs[0].settled, true);
  assert.deepEqual(merged[0].runs[0].messages, [assistant("done")]);
  assert.deepEqual(merged[0].runs[0].stream, idle);
});

test("an older persisted snapshot does not discard newer live messages", () => {
  const current = [turn("turn-1", run({ messages: [assistant("newer")], stream: live }))];
  const stored = [turn("turn-1", run())];

  const merged = mergeGroupConversationTurns(current, stored);
  assert.deepEqual(merged[0].runs[0].messages, [assistant("newer")]);
  assert.deepEqual(merged[0].runs[0].stream, live);
});

test("persisted tool calls are normalized before replacing live messages", () => {
  const current = [turn("turn-1", run({
    messages: [assistant("working")],
    stream: live,
  }))];
  const storedAssistant = {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
    timestamp: 2,
  };
  const stored = [turn("turn-1", run({ messages: [storedAssistant], settled: true }))];

  const merged = mergeGroupConversationTurns(current, stored);
  assert.deepEqual(merged[0].runs[0].messages[0].content[0], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "read",
    input: { path: "README.md" },
  });
  assert.equal(merged[0].runs[0].settled, true);
  assert.deepEqual(merged[0].runs[0].stream, idle);
});

test("fresh persisted turns normalize tool calls", () => {
  const storedAssistant = {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "pwd" } }],
  };
  const merged = mergeGroupConversationTurns([], [turn("turn-1", run({ messages: [storedAssistant], settled: true }))]);

  assert.deepEqual(merged[0].runs[0].messages[0].content[0], {
    type: "toolCall",
    toolCallId: "call-2",
    toolName: "bash",
    input: { command: "pwd" },
  });
});

test("optimistic turns absent from the snapshot are retained", () => {
  const optimistic = turn("turn-new", run({ stream: live }));
  const merged = mergeGroupConversationTurns([optimistic], []);
  assert.strictEqual(merged[0], optimistic);
});
