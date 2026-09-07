package automation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

func (s *Store) CreateRun(ctx context.Context, item Automation, source, idempotencyKey string) (Run, error) {
	return s.createRun(ctx, item, "", source, idempotencyKey, time.Now().UnixMilli())
}

func (s *Store) CreateScheduledRun(ctx context.Context, item Automation, trigger Trigger, plannedAt int64) (Run, error) {
	if plannedAt <= 0 {
		return Run{}, errors.New("scheduled run requires planned time")
	}
	return s.createRun(ctx, item, trigger.ID, "schedule", trigger.ID+":"+strconv.FormatInt(plannedAt, 10), plannedAt)
}

func (s *Store) createRun(ctx context.Context, item Automation, triggerID, source, idempotencyKey string, triggeredAt int64) (Run, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		source = "manual"
	}
	snapshot, err := json.Marshal(item.Action)
	if err != nil {
		return Run{}, err
	}
	id, err := newID("automation-run")
	if err != nil {
		return Run{}, err
	}
	now := time.Now().UnixMilli()
	if triggeredAt <= 0 {
		triggeredAt = now
	}
	var triggerValue any
	if strings.TrimSpace(triggerID) != "" {
		triggerValue = strings.TrimSpace(triggerID)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO automation_runs
		(id,automation_id,trigger_id,source,status,rule_version,action_type,action_version,action_snapshot,idempotency_key,triggered_at,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, item.ID, triggerValue, source, "received", item.RuleVersion, item.ActionType,
		item.Action.Version, []byte(snapshot), strings.TrimSpace(idempotencyKey), triggeredAt, now, now)
	if err != nil {
		return Run{}, err
	}
	return s.GetRun(ctx, id)
}

const runSelect = `SELECT id,automation_id,COALESCE(trigger_id,''),source,status,rule_version,action_type,action_version,
	action_snapshot,idempotency_key,conversation_id,conversation_deleted,turn_id,agent_run_id,failure_code,failure_reason,
	triggered_at,COALESCE(started_at,0),COALESCE(completed_at,0),created_at,updated_at FROM automation_runs`

func scanRun(scanner interface{ Scan(...any) error }) (Run, error) {
	var value Run
	var snapshot []byte
	var conversationDeleted int
	err := scanner.Scan(&value.ID, &value.AutomationID, &value.TriggerID, &value.Source, &value.Status,
		&value.RuleVersion, &value.ActionType, &value.ActionVersion, &snapshot, &value.IdempotencyKey,
		&value.ConversationID, &conversationDeleted, &value.TurnID, &value.AgentRunID, &value.FailureCode, &value.FailureReason,
		&value.TriggeredAt, &value.StartedAt, &value.CompletedAt, &value.CreatedAt, &value.UpdatedAt)
	value.ConversationDeleted = conversationDeleted != 0
	value.ActionSnapshot = append(json.RawMessage(nil), snapshot...)
	return value, err
}

func (s *Store) GetRun(ctx context.Context, id string) (Run, error) {
	return scanRun(s.db.QueryRowContext(ctx, runSelect+` WHERE id=?`, strings.TrimSpace(id)))
}

func (s *Store) reconcileRunStates(ctx context.Context) error {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='runs'`).Scan(&exists); err != nil || exists == 0 {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT ar.agent_run_id,r.status,r.error FROM automation_runs ar JOIN runs r ON r.id=ar.agent_run_id WHERE ar.status IN ('received','dispatched','running')`)
	if err != nil {
		return err
	}
	type state struct{ id, status, reason string }
	states := []state{}
	for rows.Next() {
		var value state
		if err := rows.Scan(&value.id, &value.status, &value.reason); err != nil {
			rows.Close()
			return err
		}
		states = append(states, value)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, value := range states {
		switch value.status {
		case "running":
			_ = s.MarkRunRunningByAgentRun(ctx, value.id)
		case "settled":
			_, _, _ = s.CompleteByAgentRun(ctx, value.id, "agent_settled", "")
		case "failed":
			_, _, _ = s.CompleteByAgentRun(ctx, value.id, "agent_error", value.reason)
		}
	}
	return nil
}

func (s *Store) ListRuns(ctx context.Context, automationID string, limit int) ([]Run, error) {
	if err := s.reconcileRunStates(ctx); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := runSelect
	args := []any{}
	if strings.TrimSpace(automationID) != "" {
		query += ` WHERE automation_id=?`
		args = append(args, strings.TrimSpace(automationID))
	}
	query += ` ORDER BY created_at DESC,id LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Run{}
	for rows.Next() {
		value, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (s *Store) MarkRunDispatched(ctx context.Context, id, conversationID, turnID, agentRunID string) (Run, error) {
	now := time.Now().UnixMilli()
	result, err := s.db.ExecContext(ctx, `UPDATE automation_runs SET status='dispatched',conversation_id=?,turn_id=?,agent_run_id=?,started_at=?,updated_at=? WHERE id=? AND status='received'`,
		conversationID, turnID, agentRunID, now, now, id)
	if err != nil {
		return Run{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Run{}, err
	}
	if changed == 0 {
		return Run{}, sql.ErrNoRows
	}
	return s.GetRun(ctx, id)
}

func (s *Store) FailRun(ctx context.Context, id, code, reason string) (Run, error) {
	now := time.Now().UnixMilli()
	result, err := s.db.ExecContext(ctx, `UPDATE automation_runs SET status='failed',failure_code=?,failure_reason=?,completed_at=?,updated_at=? WHERE id=? AND status NOT IN ('succeeded','failed','cancelled')`,
		strings.TrimSpace(code), strings.TrimSpace(reason), now, now, id)
	if err != nil {
		return Run{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Run{}, err
	}
	if changed == 0 {
		return Run{}, sql.ErrNoRows
	}
	return s.GetRun(ctx, id)
}

// ErrRunActive is returned when trying to delete an automation run that is still active.
var ErrRunActive = errors.New("automation run is still active")

// DeleteRuns removes automation run records by ID. Runs that are still active
// (received/admitted/queued/dispatched/running) are refused with ErrRunActive.
// Returns the number of rows actually deleted.
func (s *Store) DeleteRuns(ctx context.Context, ids []string) (int, error) {
	trimmed := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		trimmed = append(trimmed, id)
	}
	if len(trimmed) == 0 {
		return 0, nil
	}
	placeholders := strings.Repeat("?,", len(trimmed))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, 0, len(trimmed))
	for _, id := range trimmed {
		args = append(args, id)
	}
	var active int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM automation_runs WHERE id IN (`+placeholders+`) AND status IN ('received','admitted','queued','dispatched','running')`, args...).Scan(&active); err != nil {
		return 0, err
	}
	if active > 0 {
		return 0, ErrRunActive
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM automation_runs WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(affected), nil
}

func (s *Store) ClearConversationReference(ctx context.Context, conversationID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE automation_runs SET conversation_deleted=1 WHERE conversation_id=?`, strings.TrimSpace(conversationID))
	return err
}

func (s *Store) MarkRunRunningByAgentRun(ctx context.Context, agentRunID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE automation_runs SET status='running',updated_at=? WHERE agent_run_id=? AND status='dispatched'`, time.Now().UnixMilli(), strings.TrimSpace(agentRunID))
	return err
}

func (s *Store) CompleteByAgentRun(ctx context.Context, agentRunID, eventType, eventError string) (Run, bool, error) {
	status := ""
	code := ""
	reason := ""
	switch eventType {
	case "agent_settled":
		status = "succeeded"
		var content []byte
		if err := s.db.QueryRowContext(ctx, `SELECT content_json FROM conversation_messages WHERE run_id=?`, agentRunID).Scan(&content); err == nil {
			var message struct {
				StopReason   string `json:"stopReason"`
				ErrorMessage string `json:"errorMessage"`
			}
			if json.Unmarshal(content, &message) == nil && message.StopReason == "error" {
				status, code, reason = "failed", "provider_error", strings.TrimSpace(message.ErrorMessage)
			}
		}
	case "agent_error", "host_error":
		status = "failed"
		code = eventType
		reason = strings.TrimSpace(eventError)
	default:
		return Run{}, false, nil
	}
	now := time.Now().UnixMilli()
	result, err := s.db.ExecContext(ctx, `UPDATE automation_runs SET status=?,failure_code=?,failure_reason=?,completed_at=?,updated_at=?
		WHERE agent_run_id=? AND status IN ('dispatched','running')`, status, code, reason, now, now, agentRunID)
	if err != nil {
		return Run{}, false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Run{}, false, err
	}
	if changed == 0 {
		return Run{}, false, nil
	}
	var id string
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM automation_runs WHERE agent_run_id=? ORDER BY created_at DESC LIMIT 1`, agentRunID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Run{}, false, nil
		}
		return Run{}, false, err
	}
	run, err := s.GetRun(ctx, id)
	return run, true, err
}
