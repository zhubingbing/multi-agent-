package automation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite3", "file:"+filepath.ToSlash(filepath.Join(t.TempDir(), "automation.db"))+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store := NewStore(db)
	if err := store.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestAutomationRunKeepsActionSnapshotAndCompletesFromAgentRun(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	item, err := store.Create(ctx, CreateRequest{
		Name: "Daily", Status: StatusActive,
		Action: Action{Kind: ActionAgentPrompt, AgentID: "agent-1", Runbook: "original"},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(ctx, item, "manual", "manual-1")
	if err != nil {
		t.Fatal(err)
	}
	var snapshot Action
	if err := json.Unmarshal(run.ActionSnapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Runbook != "original" || run.Status != "received" {
		t.Fatalf("run snapshot = %#v", run)
	}
	name := "Changed"
	action := item.Action
	action.Runbook = "changed"
	if _, err := store.Update(ctx, item.ID, UpdateRequest{Name: &name, Action: &action}); err != nil {
		t.Fatal(err)
	}
	dispatched, err := store.MarkRunDispatched(ctx, run.ID, "conversation-1", "turn-1", "agent-run-1")
	if err != nil || dispatched.Status != "dispatched" {
		t.Fatalf("dispatch = %#v, %v", dispatched, err)
	}
	if err := store.MarkRunRunningByAgentRun(ctx, "agent-run-1"); err != nil {
		t.Fatal(err)
	}
	running, err := store.GetRun(ctx, run.ID)
	if err != nil || running.Status != "running" {
		t.Fatalf("running = %#v, %v", running, err)
	}
	completed, changed, err := store.CompleteByAgentRun(ctx, "agent-run-1", "agent_settled", "")
	if err != nil || !changed || completed.Status != "succeeded" {
		t.Fatalf("complete = %#v, %v, %v", completed, changed, err)
	}
	if err := json.Unmarshal(completed.ActionSnapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Runbook != "original" {
		t.Fatalf("historical snapshot changed: %#v", snapshot)
	}
	if err := store.ClearConversationReference(ctx, "conversation-1"); err != nil {
		t.Fatal(err)
	}
	deleted, err := store.GetRun(ctx, run.ID)
	if err != nil || !deleted.ConversationDeleted || deleted.ConversationID != "conversation-1" {
		t.Fatalf("deleted conversation marker = %#v, %v", deleted, err)
	}
}

func TestCreateAgentAndScriptAutomations(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	agent, err := store.Create(ctx, CreateRequest{
		Name:   "Daily review",
		Action: Action{Kind: ActionAgentPrompt, AgentID: "agent-1", Runbook: "Review the project."},
	})
	if err != nil {
		t.Fatal(err)
	}
	if agent.Status != StatusDraft || agent.OutputMode != "create_task" || agent.Action.Version != 1 || agent.Action.AgentID != "agent-1" {
		t.Fatalf("unexpected agent automation: %#v", agent)
	}
	script, err := store.Create(ctx, CreateRequest{
		Name: "Disk check", OutputMode: "run_only",
		Action: Action{Kind: ActionScript, RuntimeID: "runtime-1", Language: "python", Source: "print('ok')", Arguments: []string{"--json"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if script.OfflinePolicy != "skip" || script.Action.Language != "python" || len(script.Action.Arguments) != 1 {
		t.Fatalf("unexpected script automation: %#v", script)
	}
	items, err := store.List(ctx, false)
	if err != nil || len(items) != 2 {
		t.Fatalf("list = %#v, %v", items, err)
	}
}

func TestUpdateVersionsAndArchiveKeepsHistory(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	created, err := store.Create(ctx, CreateRequest{
		Name: "Review", Action: Action{Kind: ActionAgentPrompt, AgentID: "agent-1", Runbook: "v1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	name := "Updated review"
	action := created.Action
	action.Runbook = "v2"
	updated, err := store.Update(ctx, created.ID, UpdateRequest{Name: &name, Action: &action})
	if err != nil {
		t.Fatal(err)
	}
	if updated.RuleVersion != 2 || updated.Action.Version != 2 || updated.Action.Runbook != "v2" {
		t.Fatalf("versions not advanced: %#v", updated)
	}
	archived, err := store.SetStatus(ctx, created.ID, StatusArchived)
	if err != nil || archived.Status != StatusArchived {
		t.Fatalf("archive = %#v, %v", archived, err)
	}
	if _, err := store.Get(ctx, created.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("archived get error = %v", err)
	}
	items, err := store.List(ctx, true)
	if err != nil || len(items) != 1 || items[0].Status != StatusArchived {
		t.Fatalf("archived list = %#v, %v", items, err)
	}
}

func TestRejectsIncompleteActions(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	cases := []CreateRequest{
		{Name: "missing agent", Action: Action{Kind: ActionAgentPrompt, Runbook: "work"}},
		{Name: "missing source", Action: Action{Kind: ActionScript, RuntimeID: "runtime", Language: "python"}},
		{Name: "bad language", Action: Action{Kind: ActionScript, RuntimeID: "runtime", Language: "ruby", Source: "puts 1"}},
	}
	for _, test := range cases {
		if _, err := store.Create(ctx, test); err == nil {
			t.Fatalf("accepted invalid request: %#v", test)
		}
	}
}
