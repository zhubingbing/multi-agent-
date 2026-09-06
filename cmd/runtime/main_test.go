package main

import (
	"sync"
	"testing"
)

func TestReserveSessionRunRejectsOverlappingRun(t *testing.T) {
	var routes sync.Map
	first := sessionRoute{conversationID: "conversation-1", agentID: "agent-1", runID: "run-1"}
	second := sessionRoute{conversationID: "conversation-1", agentID: "agent-1", runID: "run-2"}

	if !reserveSessionRun(&routes, "session-1", first) {
		t.Fatal("first run was not reserved")
	}
	if reserveSessionRun(&routes, "session-1", second) {
		t.Fatal("overlapping run was reserved")
	}
	if got := activeRunSnapshot(&routes); len(got) != 1 || got[0].RunID != "run-1" {
		t.Fatalf("unexpected active run snapshot: %#v", got)
	}
}

func TestReleaseSessionRunDoesNotClearNewerRun(t *testing.T) {
	var routes sync.Map
	first := sessionRoute{conversationID: "conversation-1", agentID: "agent-1", runID: "run-1"}
	second := sessionRoute{conversationID: "conversation-1", agentID: "agent-1", runID: "run-2"}

	if !reserveSessionRun(&routes, "session-1", first) {
		t.Fatal("first run was not reserved")
	}
	releaseSessionRun(&routes, "session-1", "run-1")
	if !reserveSessionRun(&routes, "session-1", second) {
		t.Fatal("second run was not reserved after first finished")
	}
	releaseSessionRun(&routes, "session-1", "run-1")

	if got := activeRunSnapshot(&routes); len(got) != 1 || got[0].RunID != "run-2" {
		t.Fatalf("late release cleared newer run: %#v", got)
	}
}

func TestEventRelayRetainsEventsUntilAcknowledged(t *testing.T) {
	relay := newEventRelay()
	relay.enqueue(outboundRuntimeEvent{Type: "agent_event", RunID: "run-1", ConversationID: "conversation-1", AgentID: "agent-1"})
	relay.enqueue(outboundRuntimeEvent{Type: "agent_event", RunID: "run-1", ConversationID: "conversation-1", AgentID: "agent-1"})

	if relay.nextSeq != 2 || relay.pendingCount() != 2 {
		t.Fatalf("unexpected relay state: next=%d pending=%d", relay.nextSeq, relay.pendingCount())
	}
	if relay.pending[1].RuntimeSeq != 1 || relay.pending[2].RuntimeSeq != 2 {
		t.Fatalf("runtime sequences were not assigned monotonically: %#v", relay.pending)
	}
	relay.acknowledge(1)
	if relay.pendingCount() != 1 {
		t.Fatalf("ack did not remove exactly one event: %#v", relay.pending)
	}
	if _, exists := relay.pending[2]; !exists {
		t.Fatal("ack removed an unacknowledged event")
	}
	var routes sync.Map
	if got := reconciliationRunSnapshot(&routes, relay); len(got) != 1 || got[0].RunID != "run-1" {
		t.Fatalf("unacknowledged run missing from reconciliation: %#v", got)
	}
}
