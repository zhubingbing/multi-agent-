package automation

import "encoding/json"

const (
	StatusDraft    = "draft"
	StatusActive   = "active"
	StatusPaused   = "paused"
	StatusArchived = "archived"

	ActionAgentPrompt = "agent_prompt"
	ActionScript      = "script"
)

type Automation struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Description       string `json:"description,omitempty"`
	Status            string `json:"status"`
	ActionType        string `json:"actionType"`
	OutputMode        string `json:"outputMode"`
	ConcurrencyPolicy string `json:"concurrencyPolicy"`
	MisfirePolicy     string `json:"misfirePolicy"`
	OfflinePolicy     string `json:"offlinePolicy"`
	RuleVersion       int64  `json:"ruleVersion"`
	CreatedByType     string `json:"createdByType"`
	CreatedByID       string `json:"createdById"`
	CreatedAt         int64  `json:"createdAt"`
	UpdatedAt         int64  `json:"updatedAt"`
	Action            Action `json:"action"`
}

type Action struct {
	ID            string   `json:"id"`
	AutomationID  string   `json:"automationId"`
	Kind          string   `json:"kind"`
	Version       int64    `json:"version"`
	AgentID       string   `json:"agentId,omitempty"`
	RuntimeID     string   `json:"runtimeId,omitempty"`
	Runbook       string   `json:"runbook,omitempty"`
	Language      string   `json:"language,omitempty"`
	Source        string   `json:"source,omitempty"`
	Cwd           string   `json:"cwd,omitempty"`
	Arguments     []string `json:"arguments,omitempty"`
	SessionPolicy string   `json:"sessionPolicy"`
	CreatedAt     int64    `json:"createdAt"`
	UpdatedAt     int64    `json:"updatedAt"`
}

type Trigger struct {
	ID             string `json:"id"`
	AutomationID   string `json:"automationId"`
	Kind           string `json:"kind"`
	Enabled        bool   `json:"enabled"`
	Label          string `json:"label,omitempty"`
	CronExpression string `json:"cronExpression,omitempty"`
	Timezone       string `json:"timezone,omitempty"`
	NextFireAt     int64  `json:"nextFireAt,omitempty"`
	LastFiredAt    int64  `json:"lastFiredAt,omitempty"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
}

type Run struct {
	ID                  string          `json:"id"`
	AutomationID        string          `json:"automationId"`
	TriggerID           string          `json:"triggerId,omitempty"`
	Source              string          `json:"source"`
	Status              string          `json:"status"`
	RuleVersion         int64           `json:"ruleVersion"`
	ActionType          string          `json:"actionType"`
	ActionVersion       int64           `json:"actionVersion"`
	ActionSnapshot      json.RawMessage `json:"actionSnapshot"`
	IdempotencyKey      string          `json:"idempotencyKey,omitempty"`
	ConversationID      string          `json:"conversationId,omitempty"`
	ConversationDeleted bool            `json:"conversationDeleted,omitempty"`
	TurnID              string          `json:"turnId,omitempty"`
	AgentRunID          string          `json:"agentRunId,omitempty"`
	FailureCode         string          `json:"failureCode,omitempty"`
	FailureReason       string          `json:"failureReason,omitempty"`
	TriggeredAt         int64           `json:"triggeredAt"`
	StartedAt           int64           `json:"startedAt,omitempty"`
	CompletedAt         int64           `json:"completedAt,omitempty"`
	CreatedAt           int64           `json:"createdAt"`
	UpdatedAt           int64           `json:"updatedAt"`
}

type CreateTriggerRequest struct {
	Kind           string `json:"kind"`
	Label          string `json:"label,omitempty"`
	CronExpression string `json:"cronExpression"`
	Timezone       string `json:"timezone"`
	Enabled        *bool  `json:"enabled,omitempty"`
}

type UpdateTriggerRequest struct {
	Label          *string `json:"label,omitempty"`
	CronExpression *string `json:"cronExpression,omitempty"`
	Timezone       *string `json:"timezone,omitempty"`
	Enabled        *bool   `json:"enabled,omitempty"`
}

type ScheduledFire struct {
	Automation Automation
	Trigger    Trigger
	PlannedAt  int64
}
type CreateRequest struct {
	Name              string `json:"name"`
	Description       string `json:"description,omitempty"`
	Status            string `json:"status,omitempty"`
	OutputMode        string `json:"outputMode,omitempty"`
	ConcurrencyPolicy string `json:"concurrencyPolicy,omitempty"`
	MisfirePolicy     string `json:"misfirePolicy,omitempty"`
	OfflinePolicy     string `json:"offlinePolicy,omitempty"`
	CreatedByType     string `json:"createdByType,omitempty"`
	CreatedByID       string `json:"createdById,omitempty"`
	Action            Action `json:"action"`
}

type UpdateRequest struct {
	Name              *string `json:"name,omitempty"`
	Description       *string `json:"description,omitempty"`
	Status            *string `json:"status,omitempty"`
	OutputMode        *string `json:"outputMode,omitempty"`
	ConcurrencyPolicy *string `json:"concurrencyPolicy,omitempty"`
	MisfirePolicy     *string `json:"misfirePolicy,omitempty"`
	OfflinePolicy     *string `json:"offlinePolicy,omitempty"`
	Action            *Action `json:"action,omitempty"`
}
