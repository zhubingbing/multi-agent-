package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"multi-agent/internal/automation"
)

func runAutomationNow(ctx context.Context, automationStore *automation.Store, conversationStore *Store, h *hub, automationID string) (automation.Run, error) {
	item, err := automationStore.Get(ctx, automationID)
	if err != nil {
		return automation.Run{}, err
	}
	if item.Status == automation.StatusPaused {
		return automation.Run{}, errors.New("paused automation cannot run")
	}
	run, err := automationStore.CreateRun(ctx, item, "manual", "")
	if err != nil {
		return automation.Run{}, err
	}
	return dispatchAutomationRun(ctx, automationStore, conversationStore, h, item, run)
}

func dispatchAutomationRun(ctx context.Context, automationStore *automation.Store, conversationStore *Store, h *hub, item automation.Automation, run automation.Run) (automation.Run, error) {
	if item.Action.Kind != automation.ActionAgentPrompt {
		return automationStore.FailRun(ctx, run.ID, "action_not_implemented", "script execution will be enabled after the Runtime script protocol is available")
	}
	conversationID := newID("channel")
	createdAt := time.Now().UnixMilli()
	title := fmt.Sprintf("%s · %s", item.Name, time.UnixMilli(createdAt).Format("2006-01-02 15:04"))
	if err := conversationStore.CreateChannel(ctx, Channel{
		ID: conversationID, Title: title, AgentIDs: []string{item.Action.AgentID}, CreatedAt: createdAt,
	}); err != nil {
		failed, failErr := automationStore.FailRun(ctx, run.ID, "create_conversation_failed", err.Error())
		if failErr != nil {
			return automation.Run{}, errors.Join(err, failErr)
		}
		return failed, nil
	}
	turnID := newID("turn")
	agentRunID := newID("run")
	var err error
	run, err = automationStore.MarkRunDispatched(ctx, run.ID, conversationID, turnID, agentRunID)
	if err != nil {
		return automation.Run{}, err
	}
	dispatched, dispatchErr := dispatchConversationPrompt(ctx, h, conversationStore, conversationDispatchRequest{
		ConversationID: conversationID,
		Message:        item.Action.Runbook,
		AgentIDs:       []string{item.Action.AgentID},
		ExecutionMode:  "parallel",
		TurnID:         turnID,
		RunIDs:         map[string]string{item.Action.AgentID: agentRunID},
		AuthorType:     "system",
		AuthorID:       "automation:" + item.ID,
		CreatedAt:      createdAt,
	})
	if dispatchErr != nil {
		failed, failErr := automationStore.FailRun(ctx, run.ID, "dispatch_failed", dispatchErr.Error())
		if failErr != nil {
			return automation.Run{}, errors.Join(dispatchErr, failErr)
		}
		return failed, nil
	}
	if len(dispatched.Accepted) != 1 {
		return automationStore.FailRun(ctx, run.ID, "runtime_offline", "agent is offline or dispatch failed")
	}
	return run, nil
}
