import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildConversationMinimap } = await jiti.import("./conversation-minimap.ts");

const idle = { isStreaming: false, streamingMessage: null };
const user = (text) => ({ role: "user", content: text });
const answer = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const run = (id, messages, settled = true) => ({ id, agentId: id, messages, settled, stream: idle });

test("maps one turn to multiple completed Agent answers in stable ref order", () => {
  const result = buildConversationMinimap([{
    id: "turn-1",
    user: user("question"),
    runs: [run("host", [answer("host answer")]), run("docker", [answer("docker answer")])],
  }]);

  assert.deepEqual(result.messages.map((message) => message.role), ["user", "assistant", "assistant"]);
  assert.equal(result.anchors.get("turn-1").user, 0);
  assert.equal(result.anchors.get("turn-1").runs.get("host"), 1);
  assert.equal(result.anchors.get("turn-1").runs.get("docker"), 2);
});

test("omits running and process-only Runs from assistant previews", () => {
  const processOnly = {
    role: "assistant",
    content: [
      { type: "text", text: "inspect" },
      { type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} },
    ],
  };
  const result = buildConversationMinimap([{
    id: "turn-1",
    user: user("question"),
    runs: [run("running", [answer("partial")], false), run("process", [processOnly])],
  }]);

  assert.deepEqual(result.messages.map((message) => message.role), ["user"]);
  assert.equal(result.anchors.get("turn-1").runs.size, 0);
});
