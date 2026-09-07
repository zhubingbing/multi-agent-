package automation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const triggerSelect = `SELECT t.id,t.automation_id,t.kind,t.enabled,t.label,t.cron_expression,t.timezone,
	COALESCE(t.next_fire_at,0),COALESCE(t.last_fired_at,0),t.created_at,t.updated_at FROM automation_triggers t`

func scanTrigger(scanner interface{ Scan(...any) error }) (Trigger, error) {
	var value Trigger
	var enabled int
	err := scanner.Scan(&value.ID, &value.AutomationID, &value.Kind, &enabled, &value.Label, &value.CronExpression,
		&value.Timezone, &value.NextFireAt, &value.LastFiredAt, &value.CreatedAt, &value.UpdatedAt)
	value.Enabled = enabled != 0
	return value, err
}

func normalizeSchedule(cronExpression, timezone string) (Cron, *time.Location, string, string, error) {
	cronExpression = strings.Join(strings.Fields(strings.TrimSpace(cronExpression)), " ")
	if cronExpression == "" {
		return Cron{}, nil, "", "", errors.New("cron expression is required")
	}
	cron, err := ParseCron(cronExpression)
	if err != nil {
		return Cron{}, nil, "", "", err
	}
	timezone = strings.TrimSpace(timezone)
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return Cron{}, nil, "", "", fmt.Errorf("invalid timezone: %w", err)
	}
	return cron, location, cronExpression, timezone, nil
}

func (s *Store) CreateTrigger(ctx context.Context, automationID string, request CreateTriggerRequest) (Trigger, error) {
	if _, err := s.Get(ctx, automationID); err != nil {
		return Trigger{}, err
	}
	if strings.TrimSpace(request.Kind) == "" {
		request.Kind = "schedule"
	}
	if request.Kind != "schedule" {
		return Trigger{}, errors.New("trigger kind must be schedule")
	}
	cron, location, expression, timezone, err := normalizeSchedule(request.CronExpression, request.Timezone)
	if err != nil {
		return Trigger{}, err
	}
	enabled := true
	if request.Enabled != nil {
		enabled = *request.Enabled
	}
	now := time.Now()
	next := cron.Next(now, location)
	if next.IsZero() {
		return Trigger{}, errors.New("cron has no occurrence in the next two years")
	}
	id, err := newID("trigger")
	if err != nil {
		return Trigger{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO automation_triggers
		(id,automation_id,kind,enabled,label,cron_expression,timezone,next_fire_at,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?)`, id, automationID, request.Kind, enabled, strings.TrimSpace(request.Label), expression, timezone, next.UnixMilli(), now.UnixMilli(), now.UnixMilli())
	if err != nil {
		return Trigger{}, err
	}
	return s.GetTrigger(ctx, automationID, id)
}

func (s *Store) GetTrigger(ctx context.Context, automationID, id string) (Trigger, error) {
	return scanTrigger(s.db.QueryRowContext(ctx, triggerSelect+` WHERE automation_id=? AND id=?`, strings.TrimSpace(automationID), strings.TrimSpace(id)))
}

func (s *Store) ListTriggers(ctx context.Context, automationID string) ([]Trigger, error) {
	rows, err := s.db.QueryContext(ctx, triggerSelect+` WHERE automation_id=? ORDER BY created_at,id`, strings.TrimSpace(automationID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Trigger{}
	for rows.Next() {
		item, err := scanTrigger(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) UpdateTrigger(ctx context.Context, automationID, id string, request UpdateTriggerRequest) (Trigger, error) {
	current, err := s.GetTrigger(ctx, automationID, id)
	if err != nil {
		return Trigger{}, err
	}
	if request.Label != nil {
		current.Label = strings.TrimSpace(*request.Label)
	}
	if request.CronExpression != nil {
		current.CronExpression = *request.CronExpression
	}
	if request.Timezone != nil {
		current.Timezone = *request.Timezone
	}
	if request.Enabled != nil {
		current.Enabled = *request.Enabled
	}
	cron, location, expression, timezone, err := normalizeSchedule(current.CronExpression, current.Timezone)
	if err != nil {
		return Trigger{}, err
	}
	now := time.Now()
	next := current.NextFireAt
	if request.CronExpression != nil || request.Timezone != nil || (request.Enabled != nil && *request.Enabled) {
		candidate := cron.Next(now, location)
		if candidate.IsZero() {
			return Trigger{}, errors.New("cron has no occurrence in the next two years")
		}
		next = candidate.UnixMilli()
	}
	result, err := s.db.ExecContext(ctx, `UPDATE automation_triggers SET label=?,cron_expression=?,timezone=?,enabled=?,next_fire_at=?,updated_at=? WHERE automation_id=? AND id=?`,
		current.Label, expression, timezone, current.Enabled, next, now.UnixMilli(), automationID, id)
	if err != nil {
		return Trigger{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Trigger{}, err
	}
	if changed == 0 {
		return Trigger{}, sql.ErrNoRows
	}
	return s.GetTrigger(ctx, automationID, id)
}

func (s *Store) DeleteTrigger(ctx context.Context, automationID, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM automation_triggers WHERE automation_id=? AND id=?`, strings.TrimSpace(automationID), strings.TrimSpace(id))
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ClaimDueSchedules advances next_fire_at before returning each fire, so a later
// scanner cannot dispatch the same planned time. The scheduled run idempotency
// key is a second durable guard against duplicate effects after a process crash.
func (s *Store) ClaimDueSchedules(ctx context.Context, now time.Time, limit int) ([]ScheduledFire, error) {
	if limit <= 0 || limit > 100 {
		limit = 32
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, triggerSelect+` JOIN automations a ON a.id=t.automation_id
		WHERE a.status=? AND a.archived_at IS NULL AND t.kind='schedule' AND t.enabled=1 AND t.next_fire_at IS NOT NULL AND t.next_fire_at<=?
		ORDER BY t.next_fire_at,t.id LIMIT ?`, StatusActive, now.UnixMilli(), limit)
	if err != nil {
		return nil, err
	}
	triggers := []Trigger{}
	for rows.Next() {
		item, err := scanTrigger(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		triggers = append(triggers, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	fires := []ScheduledFire{}
	for _, trigger := range triggers {
		item, err := scanAutomation(tx.QueryRowContext(ctx, automationSelect+` WHERE a.id=? AND a.status=? AND a.archived_at IS NULL`, trigger.AutomationID, StatusActive))
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, err
		}
		cron, location, _, _, err := normalizeSchedule(trigger.CronExpression, trigger.Timezone)
		if err != nil {
			return nil, err
		}
		planned := trigger.NextFireAt
		base := time.UnixMilli(planned)
		misfired := now.Sub(base) >= time.Minute
		if misfired {
			base = now
		}
		next := cron.Next(base, location)
		if next.IsZero() {
			return nil, errors.New("cron has no next occurrence")
		}
		result, err := tx.ExecContext(ctx, `UPDATE automation_triggers SET last_fired_at=?,next_fire_at=?,updated_at=? WHERE id=? AND next_fire_at=? AND enabled=1`, planned, next.UnixMilli(), now.UnixMilli(), trigger.ID, planned)
		if err != nil {
			return nil, err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if changed == 1 && !(misfired && item.MisfirePolicy == "skip") {
			fires = append(fires, ScheduledFire{Automation: item, Trigger: trigger, PlannedAt: planned})
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return fires, nil
}
