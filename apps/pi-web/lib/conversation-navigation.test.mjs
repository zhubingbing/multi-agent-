import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { conversationUrl, resolveConversationId } = await jiti.import("./conversation-navigation.ts");

test("restores a requested conversation only when it remains available", () => {
  assert.equal(resolveConversationId(["a", "b"], "b"), "b");
  assert.equal(resolveConversationId(["a", "b"], "missing"), "a");
  assert.equal(resolveConversationId([], "missing"), "");
});

test("updates only the conversation query parameter", () => {
  assert.equal(
    conversationUrl("http://localhost/conversations?debug=1#tail", "channel-a"),
    "/conversations?debug=1&conversation=channel-a#tail",
  );
  assert.equal(
    conversationUrl("http://localhost/group?conversation=old&debug=1", ""),
    "/group?debug=1",
  );
});
