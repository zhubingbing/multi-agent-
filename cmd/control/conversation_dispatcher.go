package main

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type conversationDispatchRequest struct {
	ConversationID   string
	Message          string
	AgentIDs         []string
	ExecutionMode    string
	TurnID           string
	RunIDs           map[string]string
	CreatedAt        int64
	AuthorType       string
	AuthorID         string
	ReplyToTurnID    string
	ReplyToMessageID string
}

type conversationDispatchResult struct {
	ConversationID string            `json:"conversationId"`
	TurnID         string            `json:"turnId"`
	RunIDs         map[string]string `json:"runIds"`
	Accepted       []string          `json:"acceptedAgentIds"`
}

func dispatchConversationPrompt(ctx context.Context, h *hub, store *Store, request conversationDispatchRequest) (conversationDispatchResult, error) {
	request.ConversationID = strings.TrimSpace(request.ConversationID)
	request.Message = strings.TrimSpace(request.Message)
	if request.ConversationID == "" || request.Message == "" || len(request.AgentIDs) == 0 {
		return conversationDispatchResult{}, errors.New("conversation, message and agents are required")
	}
	if request.ExecutionMode == "" {
		request.ExecutionMode = "parallel"
	}
	if request.ExecutionMode != "parallel" && request.ExecutionMode != "sequential" {
		return conversationDispatchResult{}, errors.New("invalid execution mode")
	}
	if request.TurnID == "" {
		request.TurnID = newID("turn")
	}
	if request.CreatedAt == 0 {
		request.CreatedAt = time.Now().UnixMilli()
	}
	if request.AuthorType == "" {
		request.AuthorType = "member"
	}
	if request.AuthorID == "" {
		request.AuthorID = "local-user"
	}
	if request.RunIDs == nil {
		request.RunIDs = make(map[string]string, len(request.AgentIDs))
	}
	seen := make(map[string]struct{}, len(request.AgentIDs))
	for _, agentID := range request.AgentIDs {
		agentID = strings.TrimSpace(agentID)
		if agentID == "" {
			return conversationDispatchResult{}, errors.New("agent id is required")
		}
		if _, exists := seen[agentID]; exists {
			return conversationDispatchResult{}, errors.New("duplicate agent id")
		}
		seen[agentID] = struct{}{}
		if request.RunIDs[agentID] == "" {
			request.RunIDs[agentID] = newID("run")
		}
	}
	if err := store.CreateTurnWithMeta(ctx, request.ConversationID, request.TurnID, request.Message, request.CreatedAt, request.RunIDs, TurnMessageMeta{
		AuthorType: request.AuthorType, AuthorID: request.AuthorID, ReplyToTurnID: request.ReplyToTurnID, ReplyToMessageID: request.ReplyToMessageID,
	}); err != nil {
		return conversationDispatchResult{}, err
	}
	if request.ExecutionMode == "sequential" && len(request.AgentIDs) > 1 {
		if err := store.ConfigureSequentialTurn(ctx, request.TurnID, request.AgentIDs, request.RunIDs); err != nil {
			return conversationDispatchResult{}, err
		}
	}
	dispatchedMessage, err := store.PromptForConversation(ctx, request.ConversationID, request.TurnID, request.Message)
	if err != nil {
		return conversationDispatchResult{}, err
	}
	dispatchAgentIDs := request.AgentIDs
	if request.ExecutionMode == "sequential" && len(request.AgentIDs) > 1 {
		dispatchAgentIDs = request.AgentIDs[:1]
	}
	workspaceCwd, err := store.WorkspaceCwdForConversation(ctx, request.ConversationID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return conversationDispatchResult{}, err
	}
	accepted := h.dispatch("prompt", request.ConversationID, dispatchedMessage, dispatchAgentIDs, request.RunIDs, workspaceCwd)
	acceptedSet := make(map[string]struct{}, len(accepted))
	for _, agentID := range accepted {
		acceptedSet[agentID] = struct{}{}
	}
	for _, agentID := range dispatchAgentIDs {
		if _, ok := acceptedSet[agentID]; ok {
			continue
		}
		message := "agent is offline or dispatch failed"
		_ = store.AppendEvent(ctx, request.RunIDs[agentID], "agent_error", nil, message)
		h.broadcast(request.ConversationID, map[string]any{"type": "agent_error", "agentId": agentID, "runId": request.RunIDs[agentID], "error": message})
	}
	h.broadcast(request.ConversationID, map[string]any{"type": "dispatched", "turnId": request.TurnID, "agentIds": accepted})
	return conversationDispatchResult{ConversationID: request.ConversationID, TurnID: request.TurnID, RunIDs: request.RunIDs, Accepted: accepted}, nil
}
