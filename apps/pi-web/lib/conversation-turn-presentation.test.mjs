import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { presentAssistantTurn } = await jiti.import("./conversation-turn-presentation.ts");

const assistant = (content, usage) => ({
  role: "assistant",
  content,
  provider: "test",
  model: "model",
  usage,
});

test("uses pi-web final block rules for thinking, tools, and answer", () => {
  const first = assistant([
    { type: "thinking", thinking: "inspect" },
    { type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} },
  ], { input: 1, output: 2 });
  const final = assistant([
    { type: "thinking", thinking: "conclude" },
    { type: "text", text: "answer" },
  ], { input: 3, output: 4 });

  const result = presentAssistantTurn([first, final]);
  assert.deepEqual(result.processMessages, [first]);
  assert.deepEqual(result.finalProcessMessage.content, [{ type: "thinking", thinking: "conclude" }]);
  assert.equal(result.finalProcessMessage.usage, undefined);
  assert.deepEqual(result.finalAnswerMessage.content, [{ type: "text", text: "answer" }]);
  assert.deepEqual(result.finalAnswerMessage.usage, { input: 3, output: 4 });
});

test("text before a trailing tool call is process rather than final answer", () => {
  const message = assistant([
    { type: "text", text: "I will inspect." },
    { type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} },
  ]);

  const result = presentAssistantTurn([message]);
  assert.equal(result.processMessages.length, 0);
  assert.deepEqual(result.finalProcessMessage.content, message.content);
  assert.equal(result.finalAnswerMessage, null);
});

test("tool results are associated externally and not rendered as process messages", () => {
  const result = presentAssistantTurn([
    assistant([{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} }]),
    { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "output" }] },
    assistant([{ type: "text", text: "done" }]),
  ]);

  assert.equal(result.processMessages.length, 1);
  assert.equal(result.processMessages[0].role, "assistant");
  assert.equal(result.finalAnswerMessage.content[0].text, "done");
});
