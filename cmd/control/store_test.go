package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManagedWorkspaceDirectoryUsesServerRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MULTI_AGENT_WORKSPACE_ROOT", root)
	directory, err := managedWorkspaceDirectory("产品 研发/../", "workspace-1234567890")
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(root, directory)
	if err != nil || strings.HasPrefix(relative, "..") {
		t.Fatalf("directory escaped server root: %q, %v", directory, err)
	}
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		t.Fatalf("managed directory was not created: %q, %v", directory, err)
	}
}

func TestWorkspaceCRUDAndChannelAssignment(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	workspace := Workspace{ID: "workspace-a", Name: "产品研发", Cwd: "/projects/product", CreatedAt: 10, UpdatedAt: 10}
	if err := store.CreateWorkspace(ctx, workspace); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateChannel(ctx, Channel{ID: "workspace-channel", Title: "需求分析", WorkspaceID: workspace.ID, AgentIDs: []string{"host-pi"}, CreatedAt: 20}); err != nil {
		t.Fatal(err)
	}
	workspaces, err := store.ListWorkspaces(ctx)
	if err != nil || len(workspaces) != 2 || workspaces[0].ID != defaultWorkspaceID {
		t.Fatalf("unexpected workspaces: %#v, %v", workspaces, err)
	}
	channels, err := store.ListChannels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var assigned *Channel
	for index := range channels {
		if channels[index].ID == "workspace-channel" {
			assigned = &channels[index]
		}
	}
	if assigned == nil || assigned.WorkspaceID != workspace.ID {
		t.Fatalf("channel workspace not persisted: %#v", assigned)
	}
	updated, err := store.UpdateWorkspace(ctx, workspace.ID, "平台研发", "/projects/platform")
	if err != nil || updated.Name != "平台研发" || updated.Cwd != "/projects/platform" {
		t.Fatalf("unexpected update: %#v, %v", updated, err)
	}
	if err := store.DeleteWorkspace(ctx, workspace.ID); err != nil {
		t.Fatal(err)
	}
	channels, err = store.ListChannels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range channels {
		if channel.ID == "workspace-channel" {
			t.Fatalf("deleted workspace task was retained: %#v", channel)
		}
	}
	if err := store.DeleteWorkspace(ctx, defaultWorkspaceID); err == nil {
		t.Fatal("default workspace was deleted")
	}
}

func TestAgentMentionCreatesInboxAndAutomaticReplyRun(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.UpsertRuntimeAgents(ctx, "runtime", "Runtime", []AgentInfo{
		{ID: "docker-pi", Name: "Docker Pi", Provider: "pi", Cwd: "/workspace"},
		{ID: "host-pi", Name: "Host Pi", Provider: "pi", Cwd: "/host"},
	}); err != nil {
		t.Fatal(err)
	}
	channel := Channel{ID: "inbox-channel", Title: "Inbox", AgentIDs: []string{"docker-pi", "host-pi"}, CreatedAt: 100}
	if err := store.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(ctx, channel.ID, "inbox-turn", "investigate", 200, map[string]string{"docker-pi": "source-run"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE runs SET status='settled' WHERE id='source-run'`); err != nil {
		t.Fatal(err)
	}
	content := json.RawMessage(`{"role":"assistant","content":[{"type":"text","text":"@host-pi please verify this evidence"}],"stopReason":"stop"}`)
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO conversation_messages
		(id,conversation_id,turn_id,author_type,author_id,run_id,reply_to_message_id,content_json,created_at)
		VALUES('message-source','inbox-channel','inbox-turn','agent','docker-pi','source-run','message-inbox-turn',?,300)`, content); err != nil {
		t.Fatal(err)
	}
	if err := insertMessageMentions(ctx, tx, "inbox-turn", "message-source", publicMessageText(content)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	items, err := store.ListEmployeeInbox(ctx, "host-pi")
	if err != nil || len(items) != 1 || items[0].State != "queued" {
		t.Fatalf("unexpected inbox: %#v, %v", items, err)
	}
	runs, err := store.ClaimMentionRuns(ctx, "message-source", 4)
	if err != nil || len(runs) != 1 || runs[0].AgentID != "host-pi" || !strings.Contains(runs[0].Message, "@docker-pi") {
		t.Fatalf("unexpected automatic reply run: %#v, %v", runs, err)
	}
	if repeated, err := store.ClaimMentionRuns(ctx, "message-source", 4); err != nil || len(repeated) != 0 {
		t.Fatalf("inbox message was consumed twice: %#v, %v", repeated, err)
	}
	secondContent := json.RawMessage(`{"role":"assistant","content":[{"type":"text","text":"@host-pi second request"}],"stopReason":"stop"}`)
	tx, err = store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO conversation_messages
		(id,conversation_id,turn_id,author_type,author_id,reply_to_message_id,content_json,created_at)
		VALUES('message-source-2','inbox-channel','inbox-turn','agent','docker-pi','message-source',?,310)`, secondContent); err != nil {
		t.Fatal(err)
	}
	if err := insertMessageMentions(ctx, tx, "inbox-turn", "message-source-2", publicMessageText(secondContent)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if busyRuns, err := store.ClaimMentionRuns(ctx, "message-source-2", 4); err != nil || len(busyRuns) != 0 {
		t.Fatalf("busy employee received overlapping run: %#v, %v", busyRuns, err)
	}
	items, err = store.ListEmployeeInbox(ctx, "host-pi")
	if err != nil || len(items) != 2 || items[1].State != "queued" || items[1].Reason != "waiting for employee to become available" {
		t.Fatalf("busy inbox was not retained: %#v, %v", items, err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE runs SET status='settled' WHERE id=?`, runs[0].RunID); err != nil {
		t.Fatal(err)
	}
	pendingRuns, err := store.ClaimPendingEmployeeRuns(ctx, "host-pi", 4)
	if err != nil || len(pendingRuns) != 1 || pendingRuns[0].AgentID != "host-pi" {
		t.Fatalf("pending inbox did not resume after employee became available: %#v, %v", pendingRuns, err)
	}
	messages, err := store.ConversationMessages(ctx, channel.ID)
	if err != nil || len(messages) != 3 || len(messages[1].Mentions) != 1 || messages[1].Mentions[0] != "host-pi" {
		t.Fatalf("authoritative mention missing: %#v, %v", messages, err)
	}
}

func TestSequentialTurnStartsOneRunAtATimeWithSharedResults(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	channel := Channel{ID: "sequence-channel", Title: "Sequence", AgentIDs: []string{"docker-pi", "host-pi"}, CreatedAt: 100}
	if err := store.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	runs := map[string]string{"docker-pi": "run-docker", "host-pi": "run-host"}
	if err := store.CreateTurn(ctx, channel.ID, "turn-sequence", "inspect then verify", 200, runs); err != nil {
		t.Fatal(err)
	}
	if err := store.ConfigureSequentialTurn(ctx, "turn-sequence", []string{"docker-pi", "host-pi"}, runs); err != nil {
		t.Fatal(err)
	}
	var firstStatus, secondStatus string
	if err := store.db.QueryRowContext(ctx, `SELECT status FROM runs WHERE id='run-docker'`).Scan(&firstStatus); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT status FROM runs WHERE id='run-host'`).Scan(&secondStatus); err != nil {
		t.Fatal(err)
	}
	if firstStatus != "running" || secondStatus != "queued" {
		t.Fatalf("unexpected sequential statuses: %s, %s", firstStatus, secondStatus)
	}
	result := json.RawMessage(`{"role":"assistant","content":[{"type":"text","text":"container evidence"}],"stopReason":"stop"}`)
	if _, err := store.db.ExecContext(ctx, `INSERT INTO conversation_messages
		(id,conversation_id,turn_id,author_type,author_id,run_id,reply_to_message_id,content_json,created_at)
		VALUES('message-run-docker',?,'turn-sequence','agent','docker-pi','run-docker','message-turn-sequence',?,300)`, channel.ID, result); err != nil {
		t.Fatal(err)
	}
	next, ok, err := store.StartNextSequentialRun(ctx, "run-docker")
	if err != nil || !ok {
		t.Fatalf("next sequential run = %#v, %v, %v", next, ok, err)
	}
	if next.AgentID != "host-pi" || next.RunID != "run-host" || !strings.Contains(next.Message, "@docker-pi:\ncontainer evidence") {
		t.Fatalf("next run omitted shared result: %#v", next)
	}
	if _, ok, err := store.StartNextSequentialRun(ctx, "run-host"); err != nil || ok {
		t.Fatalf("unexpected run after sequence end: ok=%v err=%v", ok, err)
	}
}

func TestRuntimeAndAgentConfigurationAreDurable(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	registration := runtimeRegistration{
		RuntimeID: "runtime-a", InstanceID: "instance-a", Name: "Runtime A", Version: "1.2.3",
		NodeVersion: "v24", PiVersion: "0.84", OS: "linux", Architecture: "amd64",
		Capabilities: map[string]bool{"prompt": true, "abort": true},
	}
	if err := store.UpsertRuntimeNode(ctx, registration); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertRuntimeAgents(ctx, registration.RuntimeID, registration.Name, []AgentInfo{{
		ID: "agent-a", Name: "Agent A", Provider: "pi", Cwd: "/workspace",
	}}); err != nil {
		t.Fatal(err)
	}
	updated, err := store.UpdateAgentConfig(ctx, "agent-a", AgentConfigPatch{
		Name: "Configured Agent", Handle: "configured", Description: "Researcher", Instructions: "Verify evidence.",
		DesiredProvider: "custom-openai", DesiredModel: "gpt-test", DesiredThinking: "high", DesiredCwd: "/workspace/project",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Configured Agent" || updated.Provider != "pi" || updated.DesiredProvider != "custom-openai" || updated.DesiredModel != "gpt-test" || updated.ConfigVersion != 2 {
		t.Fatalf("unexpected Agent config: %#v", updated)
	}
	if err := store.UpsertRuntimeAgents(ctx, registration.RuntimeID, registration.Name, []AgentInfo{{
		ID: "agent-a", Name: "Runtime Default", Provider: "pi", Cwd: "/new-effective-cwd",
		DesiredProvider: "runtime-default", DesiredModel: "runtime-model",
	}}); err != nil {
		t.Fatal(err)
	}
	agents, err := store.ListAgents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if agents[0].Name != "Configured Agent" || agents[0].DesiredProvider != "custom-openai" || agents[0].Cwd != "/new-effective-cwd" {
		t.Fatalf("Runtime registration overwrote desired config or missed actual state: %#v", agents[0])
	}
	nodes, err := store.ListRuntimeNodes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Status != "online" || nodes[0].InstanceID != "instance-a" || nodes[0].NodeVersion != "v24" || string(nodes[0].Capabilities) != `{"abort":true,"prompt":true}` {
		t.Fatalf("unexpected Runtime node: %#v", nodes)
	}
	if err := store.TouchRuntime(ctx, "runtime-a", "instance-a"); err != nil {
		t.Fatal(err)
	}
	stale, err := store.MarkStaleRuntimes(ctx, time.Now().Add(time.Second).UnixMilli())
	if err != nil || len(stale) != 1 || stale[0] != "runtime-a" {
		t.Fatalf("Runtime was not marked stale: %#v, %v", stale, err)
	}
	nodes, err = store.ListRuntimeNodes(ctx)
	if err != nil || nodes[0].Status != "stale" {
		t.Fatalf("Runtime stale state not persisted: %#v, %v", nodes, err)
	}
	if err := store.SetRuntimeOffline(ctx, "runtime-a"); err != nil {
		t.Fatal(err)
	}
	binding := ConversationBinding{
		ConversationID: "conversation-a", AgentID: "agent-a", RuntimeID: "runtime-a", NativeSessionID: "native-1",
		State: "ready", EffectiveProvider: "custom-openai", EffectiveModel: "gpt-test", EffectiveThinking: "high", EffectiveCwd: "/workspace/project",
	}
	if err := store.UpsertBinding(ctx, binding); err != nil {
		t.Fatal(err)
	}
	bindings, err := store.ListBindings(ctx, "conversation-a")
	if err != nil || len(bindings) != 1 || bindings[0].NativeSessionID != "native-1" || bindings[0].Generation != 1 || bindings[0].EffectiveModel != "gpt-test" {
		t.Fatalf("unexpected binding: %#v, %v", bindings, err)
	}
	replacing, err := store.MarkBindingReplacing(ctx, "conversation-a", "agent-a")
	if err != nil || replacing.Generation != 2 || replacing.State != "replacing" {
		t.Fatalf("binding replacement not marked: %#v, %v", replacing, err)
	}
	binding.NativeSessionID = "native-2"
	binding.State = "ready"
	if err := store.UpsertBinding(ctx, binding); err != nil {
		t.Fatal(err)
	}
	bindings, err = store.ListBindings(ctx, "conversation-a")
	if err != nil || bindings[0].Generation != 2 || bindings[0].NativeSessionID != "native-2" || bindings[0].State != "ready" {
		t.Fatalf("replacement generation was not preserved: %#v, %v", bindings, err)
	}
	nodes, err = store.ListRuntimeNodes(ctx)
	if err != nil || nodes[0].Status != "stale" {
		t.Fatalf("stale Runtime was overwritten during disconnect cleanup: %#v, %v", nodes, err)
	}
	if _, err := store.UpdateAgentConfig(ctx, "agent-a", AgentConfigPatch{Name: "bad", DesiredThinking: "impossible"}); err == nil {
		t.Fatal("invalid thinking level was accepted")
	}
}

func TestStorePersistsChannelsAndConversationHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control.db")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}

	channel := Channel{
		ID: "channel-test", Title: "Persistent channel",
		AgentIDs: []string{"agent-a", "agent-b"}, CreatedAt: 100,
	}
	if err := store.CreateChannel(context.Background(), channel); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(context.Background(), channel.ID, "turn-1", "hello", 200, map[string]string{"agent-a": "run-1"}); err != nil {
		t.Fatal(err)
	}
	messageEvent := json.RawMessage(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"world"}],"timestamp":300}}`)
	if err := store.AppendEvent(context.Background(), "run-1", "message_end", messageEvent, ""); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendEvent(context.Background(), "run-1", "agent_settled", json.RawMessage(`{"type":"agent_settled"}`), ""); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()

	channels, err := reopened.ListChannels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var found *Channel
	for i := range channels {
		if channels[i].ID == channel.ID {
			found = &channels[i]
			break
		}
	}
	if found == nil || found.Title != channel.Title || len(found.AgentIDs) != 2 {
		t.Fatalf("persisted channel not restored: %#v", found)
	}
	if err := reopened.RenameChannel(context.Background(), channel.ID, " Renamed channel "); err != nil {
		t.Fatal(err)
	}
	channels, err = reopened.ListChannels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for i := range channels {
		if channels[i].ID == channel.ID && channels[i].Title != "Renamed channel" {
			t.Fatalf("channel title was not normalized: %#v", channels[i])
		}
	}

	turns, err := reopened.ConversationTurns(context.Background(), channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 || len(turns[0].Runs) != 1 {
		t.Fatalf("unexpected history: %#v", turns)
	}
	run := turns[0].Runs[0]
	if !run.Settled || len(run.Messages) != 1 || run.FinalMessageID != "message-run-1" {
		t.Fatalf("run was not reconstructed with authoritative final message: %#v", run)
	}
	var message struct {
		Role string `json:"role"`
	}
	if err := json.Unmarshal(run.Messages[0], &message); err != nil || message.Role != "assistant" {
		t.Fatalf("unexpected assistant message: %s (%v)", run.Messages[0], err)
	}
}

func TestStorePersistsThreadConversationIndependently(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	channel := Channel{ID: "thread-channel", Title: "Channel", AgentIDs: []string{"agent-a"}, CreatedAt: 100}
	if err := store.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateThread(ctx, Thread{ID: "invalid-root-thread", ChannelID: channel.ID, RootTurnID: "missing", Title: "Invalid", CreatedAt: 190}); err == nil {
		t.Fatal("thread accepted a root turn outside its channel")
	}
	thread := Thread{ID: "thread-1", ChannelID: channel.ID, RootTurnID: "channel-turn", Title: "Focused work", CreatedAt: 200}
	if err := store.CreateTurn(ctx, channel.ID, "channel-turn", "channel message", 180, map[string]string{"agent-a": "channel-run"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateThread(ctx, thread); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(ctx, thread.ID, "thread-turn", "thread message", 400, map[string]string{"agent-a": "thread-run"}); err != nil {
		t.Fatal(err)
	}
	channelTurns, err := store.ConversationTurns(ctx, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	threadTurns, err := store.ConversationTurns(ctx, thread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(channelTurns) != 1 || channelTurns[0].ID != "channel-turn" {
		t.Fatalf("channel history leaked thread turns: %#v", channelTurns)
	}
	if len(threadTurns) != 1 || threadTurns[0].ID != "thread-turn" {
		t.Fatalf("thread history not isolated: %#v", threadTurns)
	}
	prompt, err := store.PromptForConversation(ctx, thread.ID, "thread-turn", "first reply")
	if err != nil {
		t.Fatal(err)
	}
	if prompt != "[Thread root context]\nchannel message\n\n[Current message]\nfirst reply" {
		t.Fatalf("fresh thread prompt omitted root context: %q", prompt)
	}
	if err := store.CreateTurnWithMeta(ctx, thread.ID, "thread-second-turn", "second reply", 450, map[string]string{"agent-a": "thread-second-run"}, TurnMessageMeta{
		AuthorType: "member", AuthorID: "user-1", ReplyToTurnID: "thread-turn",
	}); err != nil {
		t.Fatal(err)
	}
	prompt, err = store.PromptForConversation(ctx, thread.ID, "thread-second-turn", "second reply")
	if err != nil {
		t.Fatal(err)
	}
	if prompt != "second reply" {
		t.Fatalf("existing thread unexpectedly reinjected root context: %q", prompt)
	}
	threadTurns, err = store.ConversationTurns(ctx, thread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(threadTurns) != 2 || threadTurns[1].User["authorType"] != "member" || threadTurns[1].User["authorId"] != "user-1" || threadTurns[1].User["replyToTurnId"] != "thread-turn" || threadTurns[1].User["replyToText"] != "thread message" {
		t.Fatalf("reply metadata was not reconstructed: %#v", threadTurns)
	}
	publicMessages, err := store.ConversationMessages(ctx, thread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(publicMessages) != 2 || publicMessages[1].AuthorID != "user-1" || publicMessages[1].ReplyToMessageID != "message-thread-turn" {
		t.Fatalf("authoritative user messages not persisted: %#v", publicMessages)
	}
	if err := store.CreateTurnWithMeta(ctx, thread.ID, "cross-reply", "invalid", 460, map[string]string{"agent-a": "cross-reply-run"}, TurnMessageMeta{
		AuthorType: "member", AuthorID: "user-1", ReplyToTurnID: "channel-turn",
	}); err == nil {
		t.Fatal("cross-conversation reply was accepted")
	}
	if err := store.CreateThread(ctx, Thread{ID: "thread-2", ChannelID: channel.ID, RootTurnID: "channel-turn", Title: "Fresh", CreatedAt: 210}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(ctx, "thread-2", "thread-2-turn", "first reply", 410, map[string]string{"agent-a": "thread-2-run"}); err != nil {
		t.Fatal(err)
	}
	prompt, err = store.PromptForConversation(ctx, "thread-2", "thread-2-turn", "first reply")
	if err != nil {
		t.Fatal(err)
	}
	if prompt != "[Thread root context]\nchannel message\n\n[Current message]\nfirst reply" {
		t.Fatalf("fresh thread prompt omitted root context: %q", prompt)
	}
	threads, err := store.ListThreads(ctx, channel.ID)
	if err != nil || len(threads) != 2 || threads[0].RootText != "channel message" {
		t.Fatalf("thread list = %#v, %v", threads, err)
	}
	if err := store.DeleteThread(ctx, thread.ID); err != nil {
		t.Fatal(err)
	}
	threads, err = store.ListThreads(ctx, channel.ID)
	if err != nil || len(threads) != 1 || threads[0].ID != "thread-2" {
		t.Fatalf("deleted thread remained visible: %#v, %v", threads, err)
	}
}

func TestRenameChannelRejectsMissingOrDeletedChannel(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.RenameChannel(ctx, "missing", "title"); err == nil {
		t.Fatal("renaming a missing channel succeeded")
	}
	channel := Channel{ID: "deleted-channel", Title: "Before", AgentIDs: []string{"agent-a"}, CreatedAt: 100}
	if err := store.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteChannel(ctx, channel.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.RenameChannel(ctx, channel.ID, "After"); err == nil {
		t.Fatal("renaming a deleted channel succeeded")
	}
	if err := store.RenameChannel(ctx, channel.ID, "   "); err == nil {
		t.Fatal("renaming to an empty title succeeded")
	}
}

func TestStoreUsesWALMode(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var mode string
	if err := store.db.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Fatalf("journal mode = %q, want wal", mode)
	}
}

func TestMentionMatchingUsesIdentityBoundaries(t *testing.T) {
	if !mentionPresent("please ask @docker-pi, then continue", "docker-pi") {
		t.Fatal("valid Agent mention was not detected")
	}
	if mentionPresent("ignore @docker-pipeline", "docker-pi") {
		t.Fatal("Agent id prefix was treated as a mention")
	}
	if !mentionPresent("请 @Host Pi 复核", "host pi") {
		t.Fatal("case-insensitive Agent name mention was not detected")
	}
}

func TestAssistantPublicAnswerRejectsToolUseText(t *testing.T) {
	if assistantHasPublicAnswer(json.RawMessage(`{"role":"assistant","stopReason":"toolUse","content":[{"type":"text","text":"I will inspect"},{"type":"toolCall","toolCallId":"1","toolName":"read","input":{}}]}`)) {
		t.Fatal("tool-use preamble was accepted as an authoritative answer")
	}
	if !assistantHasPublicAnswer(json.RawMessage(`{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"done"},{"type":"text","text":"final"}]}`)) {
		t.Fatal("final assistant answer was rejected")
	}
	if !assistantHasPublicAnswer(json.RawMessage(`{"role":"assistant","stopReason":"error","errorMessage":"provider failed","content":[]}`)) {
		t.Fatal("provider error was rejected as a public terminal message")
	}
}

func TestAppendRuntimeEventIsIdempotent(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	channel := Channel{ID: "receipt-channel", Title: "Receipts", AgentIDs: []string{"agent-a"}, CreatedAt: 100}
	if err := store.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(ctx, channel.ID, "receipt-turn", "hello", 200, map[string]string{"agent-a": "receipt-run"}); err != nil {
		t.Fatal(err)
	}
	event := queuedEvent{
		runID:     "receipt-run",
		eventType: "message_end",
		payload:   json.RawMessage(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"once"}]}}`),
	}
	inserted, err := store.AppendRuntimeEvent(ctx, "runtime-a", "instance-a", 1, event)
	if err != nil || !inserted {
		t.Fatalf("first append = (%v, %v), want inserted", inserted, err)
	}
	inserted, err = store.AppendRuntimeEvent(ctx, "runtime-a", "instance-a", 1, event)
	if err != nil || inserted {
		t.Fatalf("duplicate append = (%v, %v), want ignored", inserted, err)
	}
	var eventCount, receiptCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE run_id='receipt-run'`).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runtime_event_receipts`).Scan(&receiptCount); err != nil {
		t.Fatal(err)
	}
	if eventCount != 1 || receiptCount != 1 {
		t.Fatalf("duplicate persisted: events=%d receipts=%d", eventCount, receiptCount)
	}

	if _, err := store.db.ExecContext(ctx, `UPDATE runs SET status='failed',error='temporary reconciliation error' WHERE id='receipt-run'`); err != nil {
		t.Fatal(err)
	}
	settled := queuedEvent{runID: "receipt-run", eventType: "agent_settled", payload: json.RawMessage(`{"type":"agent_settled"}`)}
	if inserted, err := store.AppendRuntimeEvent(ctx, "runtime-a", "instance-a", 2, settled); err != nil || !inserted {
		t.Fatalf("settled append = (%v, %v), want inserted", inserted, err)
	}
	var status, runError string
	if err := store.db.QueryRowContext(ctx, `SELECT status,error FROM runs WHERE id='receipt-run'`).Scan(&status, &runError); err != nil {
		t.Fatal(err)
	}
	if status != "settled" || runError != "" {
		t.Fatalf("settled run retained stale reconciliation error: status=%q error=%q", status, runError)
	}
	var authoritativeCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM conversation_messages WHERE run_id='receipt-run'`).Scan(&authoritativeCount); err != nil {
		t.Fatal(err)
	}
	if authoritativeCount != 1 {
		t.Fatalf("settled replay produced %d authoritative messages, want 1", authoritativeCount)
	}
	messages, err := store.ConversationMessages(ctx, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].AuthorType != "member" || messages[0].Version != 1 || messages[1].AuthorType != "agent" || messages[1].Version != 2 || messages[1].RunID != "receipt-run" || messages[1].ReplyToMessageID != messages[0].ID {
		t.Fatalf("unexpected authoritative timeline: %#v", messages)
	}
	if err := store.CreateTurnWithMeta(ctx, channel.ID, "agent-reply-turn", "follow up", 400, map[string]string{"agent-a": "agent-reply-run"}, TurnMessageMeta{
		AuthorType: "member", AuthorID: "local-user", ReplyToMessageID: messages[1].ID,
	}); err != nil {
		t.Fatal(err)
	}
	messages, err = store.ConversationMessages(ctx, channel.ID)
	if err != nil || len(messages) != 3 {
		t.Fatalf("reply to Agent message failed: %#v, %v", messages, err)
	}
	var replyMessage PublicMessage
	for _, message := range messages {
		if message.ID == "message-agent-reply-turn" {
			replyMessage = message
		}
	}
	if replyMessage.ReplyToMessageID != "message-receipt-run" || replyMessage.Version != 3 {
		t.Fatalf("reply to Agent message failed: %#v", replyMessage)
	}
	if _, err := store.UpdateParticipantCursor(ctx, ParticipantCursor{
		ConversationID: channel.ID, ParticipantType: "agent", ParticipantID: "agent-a", LastSeenVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	increment, seenThrough, err := conversationIncrementTx(ctx, tx, channel.ID, "agent-a", 3)
	tx.Rollback()
	if err != nil || seenThrough != 3 || !strings.Contains(increment, "[v2 agent @agent-a]") || !strings.Contains(increment, "[v3 member @local-user]") {
		t.Fatalf("unexpected Conversation increment through %d: %q (%v)", seenThrough, increment, err)
	}
	cursor, err := store.UpdateParticipantCursor(ctx, ParticipantCursor{
		ConversationID: channel.ID, ParticipantType: "member", ParticipantID: "local-user", LastSeenVersion: 3,
	})
	if err != nil || cursor.LastSeenVersion != 3 {
		t.Fatalf("cursor update failed: %#v, %v", cursor, err)
	}
	cursor, err = store.UpdateParticipantCursor(ctx, ParticipantCursor{
		ConversationID: channel.ID, ParticipantType: "member", ParticipantID: "local-user", LastSeenVersion: 1,
	})
	if err != nil || cursor.LastSeenVersion != 3 {
		t.Fatalf("cursor moved backwards: %#v, %v", cursor, err)
	}
	if _, err := store.UpdateParticipantCursor(ctx, ParticipantCursor{
		ConversationID: channel.ID, ParticipantType: "member", ParticipantID: "local-user", LastSeenVersion: 99,
	}); err == nil {
		t.Fatal("cursor advanced beyond current Conversation version")
	}
	cursors, err := store.ConversationCursors(ctx, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(cursors) != 1 || cursors[0].RuntimeID != "runtime-a" || cursors[0].InstanceID != "instance-a" || cursors[0].Sequence != 2 {
		t.Fatalf("unexpected conversation cursors: %#v", cursors)
	}
}

func TestReconcileRuntimeRunsRestoresReportedAndFailsMissingRuns(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	agents := []AgentInfo{{ID: "agent-a", Name: "Agent A", Provider: "pi", Cwd: "/tmp"}}
	if err := store.UpsertRuntimeAgents(ctx, "runtime-a", "Runtime A", agents); err != nil {
		t.Fatal(err)
	}
	channel := Channel{ID: "reconcile-channel", Title: "Reconcile", AgentIDs: []string{"agent-a"}, CreatedAt: 100}
	if err := store.CreateChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(ctx, channel.ID, "turn-active", "active", 200, map[string]string{"agent-a": "run-active"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateTurn(ctx, channel.ID, "turn-missing", "missing", 300, map[string]string{"agent-a": "run-missing"}); err != nil {
		t.Fatal(err)
	}

	if err := store.ReconcileRuntimeRuns(ctx, "runtime-a", []activeRunInfo{{
		ConversationID: channel.ID,
		AgentID:        "agent-a",
		RunID:          "run-active",
	}}); err != nil {
		t.Fatal(err)
	}

	var activeStatus, activeError, missingStatus, missingError string
	if err := store.db.QueryRowContext(ctx, `SELECT status,error FROM runs WHERE id='run-active'`).Scan(&activeStatus, &activeError); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT status,error FROM runs WHERE id='run-missing'`).Scan(&missingStatus, &missingError); err != nil {
		t.Fatal(err)
	}
	if activeStatus != "running" || activeError != "" {
		t.Fatalf("reported active run = (%q, %q), want running with no error", activeStatus, activeError)
	}
	if missingStatus != "failed" || missingError == "" {
		t.Fatalf("missing run = (%q, %q), want failed with an explanation", missingStatus, missingError)
	}
}

func TestRuntimeNodeControlStatePersistsAcrossRegistration(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	registration := runtimeRegistration{RuntimeID: "runtime-a", InstanceID: "instance-1", Name: "Runtime A", Capabilities: map[string]bool{"prompt": true}}
	if err := store.UpsertRuntimeNode(ctx, registration); err != nil {
		t.Fatal(err)
	}
	node, err := store.GetRuntimeNode(ctx, "runtime-a")
	if err != nil || node.ControlState != "active" {
		t.Fatalf("initial node = %#v, %v", node, err)
	}
	node, err = store.SetRuntimeControlState(ctx, "runtime-a", "draining")
	if err != nil || node.ControlState != "draining" {
		t.Fatalf("drain = %#v, %v", node, err)
	}
	registration.InstanceID = "instance-2"
	if err := store.UpsertRuntimeNode(ctx, registration); err != nil {
		t.Fatal(err)
	}
	node, err = store.GetRuntimeNode(ctx, "runtime-a")
	if err != nil || node.ControlState != "draining" || node.InstanceID != "instance-2" {
		t.Fatalf("re-registered node = %#v, %v", node, err)
	}
	node, err = store.RenameRuntimeNode(ctx, "runtime-a", "Build Node")
	if err != nil || node.Name != "Build Node" {
		t.Fatalf("rename = %#v, %v", node, err)
	}
	if _, err := store.SetRuntimeControlState(ctx, "runtime-a", "broken"); err == nil {
		t.Fatal("invalid control state accepted")
	}
}

func TestRuntimePairingIsSingleUseAndCredentialIsBound(t *testing.T) {
	ctx := context.Background()
	store, err := OpenStore(filepath.Join(t.TempDir(), "control.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	pairing, err := store.CreateRuntimePairing(ctx, time.Minute)
	if err != nil || pairing.Token == "" {
		t.Fatalf("pairing = %#v, %v", pairing, err)
	}
	credential, err := store.ExchangeRuntimePairing(ctx, pairing.Token, "runtime-a")
	if err != nil || credential.Secret == "" {
		t.Fatalf("credential = %#v, %v", credential, err)
	}
	if _, err := store.ExchangeRuntimePairing(ctx, pairing.Token, "runtime-b"); err == nil {
		t.Fatal("pairing token reused")
	}
	runtimeID, err := store.VerifyRuntimeCredential(ctx, credential.Secret)
	if err != nil || runtimeID != "runtime-a" {
		t.Fatalf("verified runtime = %q, %v", runtimeID, err)
	}
	if err := store.RevokeRuntimeCredentials(ctx, "runtime-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyRuntimeCredential(ctx, credential.Secret); err == nil {
		t.Fatal("revoked credential accepted")
	}
}
