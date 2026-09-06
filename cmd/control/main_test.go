package main

import "testing"

func TestConfiguredModelUsesDesiredProviderAndModel(t *testing.T) {
	if got := configuredModel(AgentInfo{DesiredProvider: "custom-openai", DesiredModel: "gpt-test"}); got != "custom-openai/gpt-test" {
		t.Fatalf("configured model = %q", got)
	}
	if got := configuredModel(AgentInfo{DesiredProvider: "ignored", DesiredModel: "provider/model"}); got != "provider/model" {
		t.Fatalf("qualified configured model = %q", got)
	}
	if got := configuredModel(AgentInfo{DesiredProvider: "custom-openai"}); got != "" {
		t.Fatalf("incomplete configured model = %q", got)
	}
}

func TestClearActiveRunOnlyClearsMatchingRun(t *testing.T) {
	h := newHub()
	key := runKey("conversation-1", "agent-1")
	h.activeRuns[key] = "run-new"

	h.clearActiveRun("conversation-1", "agent-1", "run-old")
	if got := h.activeRun("conversation-1", "agent-1"); got != "run-new" {
		t.Fatalf("late terminal event cleared current run: got %q, want %q", got, "run-new")
	}

	h.clearActiveRun("conversation-1", "agent-1", "run-new")
	if got := h.activeRun("conversation-1", "agent-1"); got != "" {
		t.Fatalf("matching terminal event did not clear current run: got %q", got)
	}
}

func TestClearActiveRunIgnoresEmptyRunID(t *testing.T) {
	h := newHub()
	key := runKey("conversation-1", "agent-1")
	h.activeRuns[key] = "run-1"

	h.clearActiveRun("conversation-1", "agent-1", "")
	if got := h.activeRun("conversation-1", "agent-1"); got != "run-1" {
		t.Fatalf("empty terminal run id cleared current run: got %q", got)
	}
}

func TestRegisterRuntimeRestoresReportedRunsAndDropsStaleRoutes(t *testing.T) {
	h := newHub()
	h.activeRuns[runKey("stale-conversation", "agent-1")] = "stale-run"
	h.activeRuns[runKey("other-conversation", "other-agent")] = "other-run"
	runtime := &runtimePeer{
		peer:   &peer{},
		id:     "runtime-1",
		name:   "Runtime 1",
		agents: []AgentInfo{{ID: "agent-1", Name: "Agent 1"}},
		activeRuns: []activeRunInfo{{
			ConversationID: "active-conversation",
			AgentID:        "agent-1",
			RunID:          "active-run",
		}},
	}

	h.registerRuntime(runtime)
	if got := h.activeRun("stale-conversation", "agent-1"); got != "" {
		t.Fatalf("stale route survived registration: %q", got)
	}
	if got := h.activeRun("active-conversation", "agent-1"); got != "active-run" {
		t.Fatalf("reported route not restored: %q", got)
	}
	if got := h.activeRun("other-conversation", "other-agent"); got != "other-run" {
		t.Fatalf("unrelated route changed: %q", got)
	}
}
