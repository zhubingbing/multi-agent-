import assert from "node:assert/strict";
import test from "node:test";
import { ActiveRunBinding } from "../src/active-run.ts";

test("binds events to one run until that run finishes", () => {
  const binding = new ActiveRunBinding();
  binding.begin("run-1");
  assert.equal(binding.current, "run-1");
  assert.throws(() => binding.begin("run-2"), /session is streaming/);

  binding.finish("run-1");
  assert.equal(binding.current, "");
  binding.begin("run-2");
  assert.equal(binding.current, "run-2");
});

test("a late terminal event cannot clear a newer run", () => {
  const binding = new ActiveRunBinding();
  binding.begin("run-old");
  binding.finish("run-old");
  binding.begin("run-new");

  binding.finish("run-old");
  assert.equal(binding.current, "run-new");
});
