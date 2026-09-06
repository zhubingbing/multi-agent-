import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ControlConversationAdapter } = await jiti.import("./control-conversation-adapter.ts");

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 0;
  sent = [];
  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
}

test("sends a control command only when connected and preserves exact agent targets", (t) => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => { globalThis.WebSocket = previous; FakeWebSocket.instances.length = 0; });

  const adapter = new ControlConversationAdapter("conversation-1");
  assert.equal(adapter.send({ type: "abort", message: "", agentIds: ["agent-a"] }), false);
  const states = [];
  const disconnect = adapter.connect({
    onEvent: () => {},
    onReconnect: () => {},
    onStateChange: (state) => states.push(state),
  });
  const socket = FakeWebSocket.instances[0];
  assert.match(socket.url, /conversationId=conversation-1/);
  socket.readyState = FakeWebSocket.OPEN;
  socket.onopen();

  assert.equal(adapter.send({ type: "steer", message: "focus", agentIds: ["agent-b"] }), true);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: "steer",
    message: "focus",
    agentIds: ["agent-b"],
  });
  assert.deepEqual(states.slice(0, 2), ["connecting", "connected"]);
  disconnect();
});
