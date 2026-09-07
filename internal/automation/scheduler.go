package automation

import (
	"context"
	"log"
	"strings"
	"time"
)

// Scheduler is deliberately small: scheduling state and claims are durable in
// Store, while action dispatch remains owned by Control.
type Scheduler struct {
	Store    *Store
	Clock    func() time.Time
	Interval time.Duration
	Dispatch func(context.Context, ScheduledFire, Run) error
	ErrorLog func(error)
}

func (s *Scheduler) Start(ctx context.Context) {
	if s.Store == nil || s.Dispatch == nil {
		return
	}
	interval := s.Interval
	if interval <= 0 {
		interval = time.Second
	}
	go func() {
		s.scan(ctx)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.scan(ctx)
			}
		}
	}()
}

func (s *Scheduler) scan(ctx context.Context) {
	now := time.Now()
	if s.Clock != nil {
		now = s.Clock()
	}
	fires, err := s.Store.ClaimDueSchedules(ctx, now, 32)
	if err != nil {
		s.report(err)
		return
	}
	for _, fire := range fires {
		run, err := s.Store.CreateScheduledRun(ctx, fire.Automation, fire.Trigger, fire.PlannedAt)
		if err != nil {
			// The unique idempotency key makes repeat delivery of a claimed time safe.
			if !isUniqueConstraint(err) {
				s.report(err)
			}
			continue
		}
		if err := s.Dispatch(ctx, fire, run); err != nil {
			s.report(err)
		}
	}
}

func (s *Scheduler) report(err error) {
	if s.ErrorLog != nil {
		s.ErrorLog(err)
		return
	}
	log.Printf("automation scheduler: %v", err)
}

func isUniqueConstraint(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "unique constraint"))
}
