package automation

import (
	"context"
	"testing"
	"time"
)

func TestCronNextAndDaySemantics(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	cron, err := ParseCron("*/15 9-10 * * 1-5")
	if err != nil {
		t.Fatal(err)
	}
	after := time.Date(2026, 9, 4, 10, 59, 0, 0, location) // Friday.
	got := cron.Next(after, location)
	want := time.Date(2026, 9, 7, 9, 0, 0, 0, location)
	if !got.Equal(want) {
		t.Fatalf("next = %s, want %s", got, want)
	}

	orCron, err := ParseCron("0 9 1 * 1")
	if err != nil {
		t.Fatal(err)
	}
	got = orCron.Next(time.Date(2026, 8, 31, 9, 0, 0, 0, location), location)
	want = time.Date(2026, 9, 1, 9, 0, 0, 0, location) // DOM matches although DOW does not.
	if !got.Equal(want) {
		t.Fatalf("DOM/DOW next = %s, want %s", got, want)
	}
}

func TestCronRejectsInvalidExpressions(t *testing.T) {
	for _, expression := range []string{"0 9 * *", "60 9 * * *", "0 9 * * 8", "*/0 * * * *"} {
		if _, err := ParseCron(expression); err == nil {
			t.Fatalf("accepted %q", expression)
		}
	}
}

func TestSchedulerCreatesOneIdempotentRun(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	item, err := store.Create(ctx, CreateRequest{Name: "Scheduled", Status: StatusActive, Action: Action{Kind: ActionAgentPrompt, AgentID: "agent-1", Runbook: "work"}})
	if err != nil {
		t.Fatal(err)
	}
	trigger, err := store.CreateTrigger(ctx, item.ID, CreateTriggerRequest{CronExpression: "* * * * *", Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	planned := now.Add(-10 * time.Second).UnixMilli()
	if _, err := store.db.ExecContext(ctx, `UPDATE automation_triggers SET next_fire_at=? WHERE id=?`, planned, trigger.ID); err != nil {
		t.Fatal(err)
	}
	dispatched := 0
	scheduler := Scheduler{Store: store, Clock: func() time.Time { return now }, Dispatch: func(_ context.Context, fire ScheduledFire, run Run) error {
		dispatched++
		if fire.Trigger.ID != trigger.ID || run.TriggerID != trigger.ID {
			t.Fatalf("fire/run mismatch: %#v %#v", fire, run)
		}
		return nil
	}}
	scheduler.scan(ctx)
	scheduler.scan(ctx)
	if dispatched != 1 {
		t.Fatalf("dispatches = %d, want 1", dispatched)
	}
	runs, err := store.ListRuns(ctx, item.ID, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs = %#v, %v", runs, err)
	}
}

func TestTriggerCRUDAndAtomicClaim(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	item, err := store.Create(ctx, CreateRequest{Name: "Scheduled", Status: StatusActive, Action: Action{Kind: ActionAgentPrompt, AgentID: "agent-1", Runbook: "work"}})
	if err != nil {
		t.Fatal(err)
	}
	trigger, err := store.CreateTrigger(ctx, item.ID, CreateTriggerRequest{Kind: "schedule", CronExpression: "*/5 * * * *", Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	if !trigger.Enabled || trigger.NextFireAt == 0 {
		t.Fatalf("trigger = %#v", trigger)
	}

	due := time.Now().Add(-time.Minute).UnixMilli()
	if _, err := store.db.ExecContext(ctx, `UPDATE automation_triggers SET next_fire_at=? WHERE id=?`, due, trigger.ID); err != nil {
		t.Fatal(err)
	}
	fires, err := store.ClaimDueSchedules(ctx, time.Now(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(fires) != 1 || fires[0].PlannedAt != due || fires[0].Trigger.ID != trigger.ID {
		t.Fatalf("fires = %#v", fires)
	}
	fires, err = store.ClaimDueSchedules(ctx, time.Now(), 10)
	if err != nil || len(fires) != 0 {
		t.Fatalf("second claim = %#v, %v", fires, err)
	}

	run, err := store.CreateScheduledRun(ctx, item, trigger, due)
	if err != nil {
		t.Fatal(err)
	}
	if run.TriggerID != trigger.ID || run.Source != "schedule" || run.TriggeredAt != due || run.IdempotencyKey == "" {
		t.Fatalf("run = %#v", run)
	}
	if _, err := store.CreateScheduledRun(ctx, item, trigger, due); err == nil {
		t.Fatal("duplicate scheduled run accepted")
	}

	disabled := false
	updated, err := store.UpdateTrigger(ctx, item.ID, trigger.ID, UpdateTriggerRequest{Enabled: &disabled})
	if err != nil || updated.Enabled {
		t.Fatalf("disabled trigger = %#v, %v", updated, err)
	}
	if err := store.DeleteTrigger(ctx, item.ID, trigger.ID); err != nil {
		t.Fatal(err)
	}
}
