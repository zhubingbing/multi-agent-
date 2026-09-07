package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"multi-agent/internal/automation"
)

func writeAutomationJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func automationHTTPError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "automation not found", http.StatusNotFound)
		return
	}
	http.Error(w, err.Error(), http.StatusBadRequest)
}

func registerAutomationRoutes(mux *http.ServeMux, store *automation.Store, conversationStore *Store, h *hub) {
	mux.HandleFunc("/api/multi-agent/automations", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			items, err := store.List(r.Context(), r.URL.Query().Get("includeArchived") == "true")
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeAutomationJSON(w, http.StatusOK, map[string]any{"automations": items})
		case http.MethodPost:
			var request automation.CreateRequest
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			// Authentication is still an MVP gap. Never trust caller-supplied identity.
			request.CreatedByType, request.CreatedByID = "member", "local-user"
			created, err := store.Create(r.Context(), request)
			if err != nil {
				automationHTTPError(w, err)
				return
			}
			writeAutomationJSON(w, http.StatusCreated, map[string]any{"automation": created})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/multi-agent/automations/cron-preview", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var request struct {
			CronExpression string `json:"cronExpression"`
			Timezone       string `json:"timezone"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&request); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		cron, err := automation.ParseCron(request.CronExpression)
		if err != nil {
			automationHTTPError(w, err)
			return
		}
		location := time.UTC
		if timezone := strings.TrimSpace(request.Timezone); timezone != "" {
			location, err = time.LoadLocation(timezone)
			if err != nil {
				automationHTTPError(w, err)
				return
			}
		}
		next, values := time.Now(), make([]int64, 0, 5)
		for range 5 {
			next = cron.Next(next, location)
			if next.IsZero() {
				break
			}
			values = append(values, next.UnixMilli())
		}
		writeAutomationJSON(w, http.StatusOK, map[string]any{"nextFireAt": values})
	})

	mux.HandleFunc("/api/multi-agent/automations/", func(w http.ResponseWriter, r *http.Request) {
		remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/multi-agent/automations/"), "/")
		parts := strings.Split(remainder, "/")
		if remainder == "" || len(parts) > 3 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		id := strings.TrimSpace(parts[0])
		if id == "" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if len(parts) >= 2 && parts[1] == "triggers" {
			handleAutomationTriggers(w, r, store, id, parts[2:])
			return
		}
		if len(parts) == 1 {
			switch r.Method {
			case http.MethodGet:
				item, err := store.Get(r.Context(), id)
				if err != nil {
					automationHTTPError(w, err)
					return
				}
				writeAutomationJSON(w, http.StatusOK, map[string]any{"automation": item})
			case http.MethodPatch:
				var request automation.UpdateRequest
				if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
					http.Error(w, "invalid JSON", http.StatusBadRequest)
					return
				}
				item, err := store.Update(r.Context(), id, request)
				if err != nil {
					automationHTTPError(w, err)
					return
				}
				writeAutomationJSON(w, http.StatusOK, map[string]any{"automation": item})
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}
		if len(parts) != 2 || r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch parts[1] {
		case "run":
			run, err := runAutomationNow(r.Context(), store, conversationStore, h, id)
			if err != nil {
				automationHTTPError(w, err)
				return
			}
			writeAutomationJSON(w, http.StatusAccepted, map[string]any{"run": run})
		case "pause", "resume", "archive":
			status := map[string]string{"pause": automation.StatusPaused, "resume": automation.StatusActive, "archive": automation.StatusArchived}[parts[1]]
			item, err := store.SetStatus(r.Context(), id, status)
			if err != nil {
				automationHTTPError(w, err)
				return
			}
			writeAutomationJSON(w, http.StatusOK, map[string]any{"automation": item})
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	})

	mux.HandleFunc("/api/multi-agent/automation-runs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		runs, err := store.ListRuns(r.Context(), r.URL.Query().Get("automationId"), 100)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeAutomationJSON(w, http.StatusOK, map[string]any{"runs": runs})
	})
}

func handleAutomationTriggers(w http.ResponseWriter, r *http.Request, store *automation.Store, automationID string, rest []string) {
	if len(rest) == 0 {
		switch r.Method {
		case http.MethodGet:
			items, err := store.ListTriggers(r.Context(), automationID)
			if err != nil {
				automationHTTPError(w, err)
				return
			}
			writeAutomationJSON(w, http.StatusOK, map[string]any{"triggers": items})
		case http.MethodPost:
			var request automation.CreateTriggerRequest
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			item, err := store.CreateTrigger(r.Context(), automationID, request)
			if err != nil {
				automationHTTPError(w, err)
				return
			}
			writeAutomationJSON(w, http.StatusCreated, map[string]any{"trigger": item})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	if len(rest) != 1 || strings.TrimSpace(rest[0]) == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	triggerID := rest[0]
	switch r.Method {
	case http.MethodPatch:
		var request automation.UpdateTriggerRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		item, err := store.UpdateTrigger(r.Context(), automationID, triggerID, request)
		if err != nil {
			automationHTTPError(w, err)
			return
		}
		writeAutomationJSON(w, http.StatusOK, map[string]any{"trigger": item})
	case http.MethodDelete:
		if err := store.DeleteTrigger(r.Context(), automationID, triggerID); err != nil {
			automationHTTPError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
