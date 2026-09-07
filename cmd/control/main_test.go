package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"multi-agent/internal/automation"
)

func TestAutomationHTTPCreateListAndPause(t *testing.T) {
	conversationStore, err := OpenStore(filepath.Join(t.TempDir(), "automation-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer conversationStore.Close()
	store := automation.NewStore(conversationStore.db)
	if err := store.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	registerAutomationRoutes(mux, store, conversationStore, newHub())
	server := httptest.NewServer(mux)
	defer server.Close()

	body := []byte(`{"name":"Daily review","status":"active","action":{"kind":"agent_prompt","agentId":"agent-1","runbook":"Review changes."}}`)
	response, err := http.Post(server.URL+"/api/multi-agent/automations", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d", response.StatusCode)
	}
	var created struct {
		Automation automation.Automation `json:"automation"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.Automation.CreatedByID != "local-user" || created.Automation.Action.AgentID != "agent-1" {
		t.Fatalf("unexpected created automation: %#v", created.Automation)
	}

	preview, err := http.Post(server.URL+"/api/multi-agent/automations/cron-preview", "application/json", bytes.NewReader([]byte(`{"cronExpression":"0 9 * * 1-5","timezone":"Asia/Shanghai"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer preview.Body.Close()
	if preview.StatusCode != http.StatusOK {
		t.Fatalf("preview status = %d", preview.StatusCode)
	}
	var previewResult struct {
		NextFireAt []int64 `json:"nextFireAt"`
	}
	if err := json.NewDecoder(preview.Body).Decode(&previewResult); err != nil || len(previewResult.NextFireAt) != 5 {
		t.Fatalf("preview = %#v, %v", previewResult, err)
	}

	triggerResponse, err := http.Post(server.URL+"/api/multi-agent/automations/"+created.Automation.ID+"/triggers", "application/json", bytes.NewReader([]byte(`{"kind":"schedule","cronExpression":"0 9 * * 1-5","timezone":"Asia/Shanghai"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer triggerResponse.Body.Close()
	if triggerResponse.StatusCode != http.StatusCreated {
		t.Fatalf("trigger status = %d", triggerResponse.StatusCode)
	}
	var triggerResult struct {
		Trigger automation.Trigger `json:"trigger"`
	}
	if err := json.NewDecoder(triggerResponse.Body).Decode(&triggerResult); err != nil {
		t.Fatal(err)
	}
	if triggerResult.Trigger.NextFireAt == 0 || triggerResult.Trigger.Timezone != "Asia/Shanghai" {
		t.Fatalf("trigger = %#v", triggerResult.Trigger)
	}

	pause, err := http.Post(server.URL+"/api/multi-agent/automations/"+created.Automation.ID+"/pause", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer pause.Body.Close()
	if pause.StatusCode != http.StatusOK {
		t.Fatalf("pause status = %d", pause.StatusCode)
	}

	list, err := http.Get(server.URL + "/api/multi-agent/automations")
	if err != nil {
		t.Fatal(err)
	}
	defer list.Body.Close()
	var result struct {
		Automations []automation.Automation `json:"automations"`
	}
	if err := json.NewDecoder(list.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.Automations) != 1 || result.Automations[0].Status != automation.StatusPaused {
		t.Fatalf("unexpected automation list: %#v", result.Automations)
	}

	resume, err := http.Post(server.URL+"/api/multi-agent/automations/"+created.Automation.ID+"/resume", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = resume.Body.Close()
	if resume.StatusCode != http.StatusOK {
		t.Fatalf("resume status = %d", resume.StatusCode)
	}
	runResponse, err := http.Post(server.URL+"/api/multi-agent/automations/"+created.Automation.ID+"/run", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer runResponse.Body.Close()
	if runResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("run status = %d", runResponse.StatusCode)
	}
	var runResult struct {
		Run automation.Run `json:"run"`
	}
	if err := json.NewDecoder(runResponse.Body).Decode(&runResult); err != nil {
		t.Fatal(err)
	}
	if runResult.Run.Status != "failed" || runResult.Run.FailureCode != "runtime_offline" || runResult.Run.ConversationID == "" {
		t.Fatalf("unexpected offline run: %#v", runResult.Run)
	}
}

func TestHubListsModelsForAgentRuntime(t *testing.T) {
	h := newHub()
	h.registerRuntime(&runtimePeer{
		peer: &peer{}, id: "runtime-1", name: "Runtime 1",
		agents: []AgentInfo{{ID: "agent-1", Name: "Agent 1"}},
		models: []runtimeModelInfo{{Provider: "custom-openai", ID: "gpt-test", Name: "GPT Test", Reasoning: true}},
	})
	h.registerRuntime(&runtimePeer{
		peer: &peer{}, id: "runtime-2", name: "Runtime 2",
		agents: []AgentInfo{{ID: "agent-2", Name: "Agent 2"}},
		models: []runtimeModelInfo{{Provider: "anthropic", ID: "claude-test", Name: "Claude Test"}},
	})
	models, modelError := h.listModels("agent-1")
	if modelError != "" || len(models) != 1 || models[0].ID != "gpt-test" || models[0].RuntimeID != "runtime-1" {
		t.Fatalf("models = %#v, error = %q", models, modelError)
	}
}

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
