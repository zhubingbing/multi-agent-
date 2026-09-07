package automation

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) Initialize(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS automations (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			action_type TEXT NOT NULL,
			output_mode TEXT NOT NULL,
			concurrency_policy TEXT NOT NULL,
			misfire_policy TEXT NOT NULL,
			offline_policy TEXT NOT NULL,
			rule_version INTEGER NOT NULL DEFAULT 1,
			created_by_type TEXT NOT NULL,
			created_by_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			archived_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS automation_actions (
			id TEXT PRIMARY KEY,
			automation_id TEXT NOT NULL UNIQUE REFERENCES automations(id) ON DELETE CASCADE,
			kind TEXT NOT NULL,
			version INTEGER NOT NULL DEFAULT 1,
			agent_id TEXT NOT NULL DEFAULT '',
			runtime_id TEXT NOT NULL DEFAULT '',
			runbook TEXT NOT NULL DEFAULT '',
			language TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT '',
			cwd TEXT NOT NULL DEFAULT '',
			arguments_json BLOB NOT NULL DEFAULT '[]',
			session_policy TEXT NOT NULL DEFAULT 'fresh',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS automation_triggers (
			id TEXT PRIMARY KEY,
			automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
			kind TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			label TEXT NOT NULL DEFAULT '',
			cron_expression TEXT NOT NULL DEFAULT '',
			timezone TEXT NOT NULL DEFAULT '',
			next_fire_at INTEGER,
			last_fired_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS automation_triggers_due ON automation_triggers(kind,enabled,next_fire_at)`,
		`CREATE TABLE IF NOT EXISTS automation_runs (
			id TEXT PRIMARY KEY,
			automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
			trigger_id TEXT REFERENCES automation_triggers(id) ON DELETE SET NULL,
			source TEXT NOT NULL,
			status TEXT NOT NULL,
			rule_version INTEGER NOT NULL,
			action_type TEXT NOT NULL,
			action_version INTEGER NOT NULL,
			action_snapshot BLOB NOT NULL,
			idempotency_key TEXT NOT NULL DEFAULT '',
			conversation_id TEXT NOT NULL DEFAULT '',
			conversation_deleted INTEGER NOT NULL DEFAULT 0,
			turn_id TEXT NOT NULL DEFAULT '',
			agent_run_id TEXT NOT NULL DEFAULT '',
			failure_code TEXT NOT NULL DEFAULT '',
			failure_reason TEXT NOT NULL DEFAULT '',
			triggered_at INTEGER NOT NULL,
			started_at INTEGER,
			completed_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_idempotency ON automation_runs(automation_id,idempotency_key) WHERE idempotency_key<>''`,
		`CREATE INDEX IF NOT EXISTS automation_runs_history ON automation_runs(automation_id,created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize automation store: %w", err)
		}
	}
	if _, err := s.db.ExecContext(ctx, `ALTER TABLE automation_runs ADD COLUMN conversation_deleted INTEGER NOT NULL DEFAULT 0`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		return fmt.Errorf("add automation run conversation_deleted: %w", err)
	}
	return nil
}

func newID(prefix string) (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(value[:]), nil
}

func normalizeCreate(request CreateRequest) (CreateRequest, error) {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Action.Kind = strings.TrimSpace(request.Action.Kind)
	request.Action.AgentID = strings.TrimSpace(request.Action.AgentID)
	request.Action.RuntimeID = strings.TrimSpace(request.Action.RuntimeID)
	request.Action.Language = strings.ToLower(strings.TrimSpace(request.Action.Language))
	request.Action.Cwd = strings.TrimSpace(request.Action.Cwd)
	if request.Name == "" {
		return request, errors.New("automation name is required")
	}
	if request.Status == "" {
		request.Status = StatusDraft
	}
	if !validStatus(request.Status) || request.Status == StatusArchived {
		return request, errors.New("invalid initial automation status")
	}
	if request.OutputMode == "" {
		request.OutputMode = "create_task"
	}
	if request.OutputMode != "create_task" && request.OutputMode != "run_only" {
		return request, errors.New("invalid output mode")
	}
	if request.ConcurrencyPolicy == "" {
		request.ConcurrencyPolicy = "queue_one"
	}
	if request.MisfirePolicy == "" {
		request.MisfirePolicy = "latest"
	}
	if request.OfflinePolicy == "" {
		if request.OutputMode == "run_only" {
			request.OfflinePolicy = "skip"
		} else {
			request.OfflinePolicy = "queue"
		}
	}
	if request.CreatedByType == "" {
		request.CreatedByType = "member"
	}
	if request.CreatedByID == "" {
		request.CreatedByID = "local-user"
	}
	if request.Action.SessionPolicy == "" {
		request.Action.SessionPolicy = "fresh"
	}
	switch request.Action.Kind {
	case ActionAgentPrompt:
		if request.Action.AgentID == "" || strings.TrimSpace(request.Action.Runbook) == "" {
			return request, errors.New("agent_prompt requires agentId and runbook")
		}
	case ActionScript:
		if request.Action.RuntimeID == "" || strings.TrimSpace(request.Action.Source) == "" {
			return request, errors.New("script requires runtimeId and source")
		}
		if request.Action.Language != "shell" && request.Action.Language != "python" && request.Action.Language != "go" {
			return request, errors.New("script language must be shell, python, or go")
		}
	default:
		return request, errors.New("action kind must be agent_prompt or script")
	}
	return request, nil
}

func validStatus(value string) bool {
	return value == StatusDraft || value == StatusActive || value == StatusPaused || value == StatusArchived
}

func (s *Store) Create(ctx context.Context, request CreateRequest) (Automation, error) {
	request, err := normalizeCreate(request)
	if err != nil {
		return Automation{}, err
	}
	automationID, err := newID("automation")
	if err != nil {
		return Automation{}, err
	}
	actionID, err := newID("action")
	if err != nil {
		return Automation{}, err
	}
	now := time.Now().UnixMilli()
	arguments, err := json.Marshal(request.Action.Arguments)
	if err != nil {
		return Automation{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Automation{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO automations
		(id,name,description,status,action_type,output_mode,concurrency_policy,misfire_policy,offline_policy,rule_version,created_by_type,created_by_id,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?)`, automationID, request.Name, request.Description, request.Status,
		request.Action.Kind, request.OutputMode, request.ConcurrencyPolicy, request.MisfirePolicy, request.OfflinePolicy,
		request.CreatedByType, request.CreatedByID, now, now)
	if err != nil {
		return Automation{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO automation_actions
		(id,automation_id,kind,version,agent_id,runtime_id,runbook,language,source,cwd,arguments_json,session_policy,created_at,updated_at)
		VALUES(?,?,?,1,?,?,?,?,?,?,?,?,?,?)`, actionID, automationID, request.Action.Kind, request.Action.AgentID,
		request.Action.RuntimeID, request.Action.Runbook, request.Action.Language, request.Action.Source, request.Action.Cwd,
		arguments, request.Action.SessionPolicy, now, now)
	if err != nil {
		return Automation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Automation{}, err
	}
	return s.Get(ctx, automationID)
}

const automationSelect = `SELECT a.id,a.name,a.description,a.status,a.action_type,a.output_mode,a.concurrency_policy,
	a.misfire_policy,a.offline_policy,a.rule_version,a.created_by_type,a.created_by_id,a.created_at,a.updated_at,
	x.id,x.automation_id,x.kind,x.version,x.agent_id,x.runtime_id,x.runbook,x.language,x.source,x.cwd,
	x.arguments_json,x.session_policy,x.created_at,x.updated_at
	FROM automations a JOIN automation_actions x ON x.automation_id=a.id`

func scanAutomation(scanner interface{ Scan(...any) error }) (Automation, error) {
	var value Automation
	var arguments []byte
	err := scanner.Scan(&value.ID, &value.Name, &value.Description, &value.Status, &value.ActionType, &value.OutputMode,
		&value.ConcurrencyPolicy, &value.MisfirePolicy, &value.OfflinePolicy, &value.RuleVersion, &value.CreatedByType,
		&value.CreatedByID, &value.CreatedAt, &value.UpdatedAt, &value.Action.ID, &value.Action.AutomationID,
		&value.Action.Kind, &value.Action.Version, &value.Action.AgentID, &value.Action.RuntimeID, &value.Action.Runbook,
		&value.Action.Language, &value.Action.Source, &value.Action.Cwd, &arguments, &value.Action.SessionPolicy,
		&value.Action.CreatedAt, &value.Action.UpdatedAt)
	if err != nil {
		return Automation{}, err
	}
	if err := json.Unmarshal(arguments, &value.Action.Arguments); err != nil {
		return Automation{}, fmt.Errorf("decode action arguments: %w", err)
	}
	return value, nil
}

func (s *Store) Get(ctx context.Context, id string) (Automation, error) {
	return scanAutomation(s.db.QueryRowContext(ctx, automationSelect+` WHERE a.id=? AND a.archived_at IS NULL`, strings.TrimSpace(id)))
}

func (s *Store) List(ctx context.Context, includeArchived bool) ([]Automation, error) {
	query := automationSelect
	if !includeArchived {
		query += ` WHERE a.archived_at IS NULL`
	}
	query += ` ORDER BY a.created_at DESC,a.id`
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Automation{}
	for rows.Next() {
		value, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (s *Store) Update(ctx context.Context, id string, request UpdateRequest) (Automation, error) {
	current, err := s.Get(ctx, id)
	if err != nil {
		return Automation{}, err
	}
	create := CreateRequest{
		Name: current.Name, Description: current.Description, Status: current.Status, OutputMode: current.OutputMode,
		ConcurrencyPolicy: current.ConcurrencyPolicy, MisfirePolicy: current.MisfirePolicy, OfflinePolicy: current.OfflinePolicy,
		CreatedByType: current.CreatedByType, CreatedByID: current.CreatedByID, Action: current.Action,
	}
	if request.Name != nil {
		create.Name = *request.Name
	}
	if request.Description != nil {
		create.Description = *request.Description
	}
	if request.Status != nil {
		create.Status = *request.Status
	}
	if request.OutputMode != nil {
		create.OutputMode = *request.OutputMode
	}
	if request.ConcurrencyPolicy != nil {
		create.ConcurrencyPolicy = *request.ConcurrencyPolicy
	}
	if request.MisfirePolicy != nil {
		create.MisfirePolicy = *request.MisfirePolicy
	}
	if request.OfflinePolicy != nil {
		create.OfflinePolicy = *request.OfflinePolicy
	}
	if request.Action != nil {
		create.Action = *request.Action
	}
	create, err = normalizeCreate(create)
	if err != nil {
		return Automation{}, err
	}
	now := time.Now().UnixMilli()
	arguments, err := json.Marshal(create.Action.Arguments)
	if err != nil {
		return Automation{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Automation{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `UPDATE automations SET name=?,description=?,status=?,action_type=?,output_mode=?,
		concurrency_policy=?,misfire_policy=?,offline_policy=?,rule_version=rule_version+1,updated_at=? WHERE id=? AND archived_at IS NULL`,
		create.Name, create.Description, create.Status, create.Action.Kind, create.OutputMode, create.ConcurrencyPolicy,
		create.MisfirePolicy, create.OfflinePolicy, now, id)
	if err != nil {
		return Automation{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE automation_actions SET kind=?,version=version+1,agent_id=?,runtime_id=?,runbook=?,
		language=?,source=?,cwd=?,arguments_json=?,session_policy=?,updated_at=? WHERE automation_id=?`,
		create.Action.Kind, create.Action.AgentID, create.Action.RuntimeID, create.Action.Runbook, create.Action.Language,
		create.Action.Source, create.Action.Cwd, arguments, create.Action.SessionPolicy, now, id)
	if err != nil {
		return Automation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Automation{}, err
	}
	return s.Get(ctx, id)
}

func (s *Store) SetStatus(ctx context.Context, id, status string) (Automation, error) {
	if !validStatus(status) {
		return Automation{}, errors.New("invalid automation status")
	}
	now := time.Now().UnixMilli()
	var result sql.Result
	var err error
	if status == StatusArchived {
		result, err = s.db.ExecContext(ctx, `UPDATE automations SET status=?,archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL`, status, now, now, id)
	} else {
		result, err = s.db.ExecContext(ctx, `UPDATE automations SET status=?,updated_at=? WHERE id=? AND archived_at IS NULL`, status, now, id)
	}
	if err != nil {
		return Automation{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Automation{}, err
	}
	if changed == 0 {
		return Automation{}, sql.ErrNoRows
	}
	if status == StatusArchived {
		current, err := s.List(ctx, true)
		if err != nil {
			return Automation{}, err
		}
		for _, value := range current {
			if value.ID == id {
				return value, nil
			}
		}
		return Automation{}, sql.ErrNoRows
	}
	return s.Get(ctx, id)
}

func (s *Store) Close() error { return nil }
