package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type AgentInfo struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	RuntimeID       string `json:"runtimeId"`
	Runtime         string `json:"runtime"`
	Provider        string `json:"provider"`
	Cwd             string `json:"cwd"`
	Online          bool   `json:"online"`
	Handle          string `json:"handle,omitempty"`
	Description     string `json:"description,omitempty"`
	Instructions    string `json:"instructions,omitempty"`
	DesiredProvider string `json:"desiredProvider,omitempty"`
	DesiredModel    string `json:"desiredModel,omitempty"`
	DesiredThinking string `json:"desiredThinkingLevel,omitempty"`
	DesiredCwd      string `json:"desiredCwd,omitempty"`
	ConfigVersion   int64  `json:"configVersion"`
	Presence        string `json:"presence"`
	InboxUnread     int64  `json:"inboxUnread"`
}

type activeRunInfo struct {
	ConversationID string `json:"conversationId"`
	AgentID        string `json:"agentId"`
	RunID          string `json:"runId"`
}

type runtimeRegistration struct {
	Type         string          `json:"type"`
	RuntimeID    string          `json:"runtimeId"`
	InstanceID   string          `json:"instanceId"`
	Name         string          `json:"name"`
	Version      string          `json:"version"`
	NodeVersion  string          `json:"nodeVersion"`
	PiVersion    string          `json:"piVersion"`
	OS           string          `json:"os"`
	Architecture string          `json:"architecture"`
	Capabilities map[string]bool `json:"capabilities"`
	Agents       []AgentInfo     `json:"agents"`
	ActiveRuns   []activeRunInfo `json:"activeRuns,omitempty"`
}

type browserCommand struct {
	Type             string            `json:"type"`
	Message          string            `json:"message"`
	AgentIDs         []string          `json:"agentIds"`
	TurnID           string            `json:"turnId"`
	RunIDs           map[string]string `json:"runIds"`
	CreatedAt        int64             `json:"createdAt"`
	ReplyToTurnID    string            `json:"replyToTurnId"`
	ReplyToMessageID string            `json:"replyToMessageId"`
	ExecutionMode    string            `json:"executionMode"`
}

type runtimeCommand struct {
	Type           string `json:"type"`
	RequestID      string `json:"requestId"`
	RunID          string `json:"runId"`
	ConversationID string `json:"conversationId"`
	AgentID        string `json:"agentId"`
	Message        string `json:"message"`
	Cwd            string `json:"cwd"`
	Model          string `json:"model,omitempty"`
	ThinkingLevel  string `json:"thinkingLevel,omitempty"`
}

type runtimeEvent struct {
	Type           string          `json:"type"`
	RuntimeSeq     uint64          `json:"runtimeSeq"`
	RunID          string          `json:"runId"`
	ConversationID string          `json:"conversationId"`
	AgentID        string          `json:"agentId"`
	Event          json.RawMessage `json:"event"`
	Error          string          `json:"error,omitempty"`
}

type peer struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (p *peer) write(value any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.conn.WriteJSON(value)
}

type runtimePeer struct {
	*peer
	id         string
	instanceID string
	name       string
	agents     []AgentInfo
	activeRuns []activeRunInfo
}

type browserPeer struct {
	*peer
	conversationID string
}

type hub struct {
	mu         sync.RWMutex
	runtimes   map[string]*runtimePeer
	browsers   map[*browserPeer]struct{}
	agents     map[string]AgentInfo
	activeRuns map[string]string
	seq        uint64
}

func newHub() *hub {
	return &hub{
		runtimes:   make(map[string]*runtimePeer),
		browsers:   make(map[*browserPeer]struct{}),
		agents:     make(map[string]AgentInfo),
		activeRuns: make(map[string]string),
	}
}

func (h *hub) registerRuntime(runtime *runtimePeer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if previous := h.runtimes[runtime.id]; previous != nil && previous != runtime {
		_ = previous.conn.Close()
	}
	h.runtimes[runtime.id] = runtime
	runtimeAgentIDs := make(map[string]struct{}, len(runtime.agents))
	for _, agent := range runtime.agents {
		runtimeAgentIDs[agent.ID] = struct{}{}
		agent.RuntimeID = runtime.id
		agent.Runtime = runtime.name
		agent.Online = true
		h.agents[agent.ID] = agent
	}
	for key := range h.activeRuns {
		for agentID := range runtimeAgentIDs {
			if strings.HasSuffix(key, "\x00"+agentID) {
				delete(h.activeRuns, key)
			}
		}
	}
	for _, active := range runtime.activeRuns {
		if active.ConversationID == "" || active.RunID == "" {
			continue
		}
		if _, ok := runtimeAgentIDs[active.AgentID]; !ok {
			continue
		}
		h.activeRuns[runKey(active.ConversationID, active.AgentID)] = active.RunID
	}
}

func (h *hub) disconnectRuntime(runtimeID string) {
	h.mu.RLock()
	runtime := h.runtimes[runtimeID]
	h.mu.RUnlock()
	if runtime != nil {
		_ = runtime.conn.Close()
	}
}

func (h *hub) updateAgentConfig(agent AgentInfo) {
	h.mu.Lock()
	defer h.mu.Unlock()
	current, ok := h.agents[agent.ID]
	if !ok {
		return
	}
	agent.Online = current.Online
	agent.RuntimeID = current.RuntimeID
	agent.Runtime = current.Runtime
	agent.Provider = current.Provider
	agent.Cwd = current.Cwd
	h.agents[agent.ID] = agent
}

func (h *hub) unregisterRuntime(runtime *runtimePeer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.runtimes[runtime.id] != runtime {
		return
	}
	delete(h.runtimes, runtime.id)
	for _, agent := range runtime.agents {
		current := h.agents[agent.ID]
		current.Online = false
		h.agents[agent.ID] = current
	}
}

func (h *hub) listAgents() []AgentInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make([]AgentInfo, 0, len(h.agents))
	for _, agent := range h.agents {
		result = append(result, agent)
	}
	return result
}

func (h *hub) allAgentIDs() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	ids := make([]string, 0, len(h.agents))
	for id := range h.agents {
		ids = append(ids, id)
	}
	return ids
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func configuredModel(agent AgentInfo) string {
	model := strings.TrimSpace(agent.DesiredModel)
	provider := strings.TrimSpace(agent.DesiredProvider)
	if strings.Contains(model, "/") {
		return model
	}
	if provider != "" && model != "" {
		return provider + "/" + model
	}
	return ""
}

func runKey(conversationID, agentID string) string {
	return conversationID + "\x00" + agentID
}

func (h *hub) activeRun(conversationID, agentID string) string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.activeRuns[runKey(conversationID, agentID)]
}

func (h *hub) clearActiveRun(conversationID, agentID, runID string) {
	if runID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	key := runKey(conversationID, agentID)
	if h.activeRuns[key] == runID {
		delete(h.activeRuns, key)
	}
}

func (h *hub) dispatch(action, conversationID, message string, agentIDs []string, runIDs map[string]string) []string {
	h.mu.Lock()
	h.seq++
	requestID := fmt.Sprintf("run-%d", h.seq)
	type target struct {
		runtime *runtimePeer
		agent   AgentInfo
	}
	targets := make([]target, 0, len(agentIDs))
	for _, id := range agentIDs {
		agent, ok := h.agents[id]
		if !ok || !agent.Online {
			continue
		}
		if action == "prompt" && runIDs[id] != "" {
			h.activeRuns[runKey(conversationID, id)] = runIDs[id]
		}
		if runtime := h.runtimes[agent.RuntimeID]; runtime != nil {
			targets = append(targets, target{runtime: runtime, agent: agent})
		}
	}
	h.mu.Unlock()

	accepted := make([]string, 0, len(targets))
	for _, target := range targets {
		runID := runIDs[target.agent.ID]
		if runID == "" {
			runID = h.activeRun(conversationID, target.agent.ID)
		}
		command := runtimeCommand{
			Type:           action,
			RequestID:      requestID + ":" + target.agent.ID,
			RunID:          runID,
			ConversationID: conversationID,
			AgentID:        target.agent.ID,
			Message:        message,
			Cwd:            firstNonEmpty(target.agent.DesiredCwd, target.agent.Cwd),
			Model:          configuredModel(target.agent),
			ThinkingLevel:  target.agent.DesiredThinking,
		}
		if err := target.runtime.write(command); err != nil {
			log.Printf("dispatch to %s failed: %v", target.runtime.id, err)
			continue
		}
		accepted = append(accepted, target.agent.ID)
	}
	return accepted
}

func (h *hub) broadcast(conversationID string, value any) {
	h.mu.RLock()
	peers := make([]*browserPeer, 0, len(h.browsers))
	for browser := range h.browsers {
		if browser.conversationID == conversationID {
			peers = append(peers, browser)
		}
	}
	h.mu.RUnlock()
	for _, browser := range peers {
		if err := browser.write(value); err != nil {
			_ = browser.conn.Close()
		}
	}
}

func persistSessionState(ctx context.Context, store *Store, runtimeID string, event runtimeEvent) (bool, error) {
	var state struct {
		SessionID     string `json:"sessionId"`
		Cwd           string `json:"cwd"`
		ThinkingLevel string `json:"thinkingLevel"`
		IsStreaming   bool   `json:"isStreaming"`
		Model         *struct {
			Provider string `json:"provider"`
			ID       string `json:"id"`
		} `json:"model"`
	}
	if json.Unmarshal(event.Event, &state) != nil || state.SessionID == "" {
		return false, nil
	}
	binding := ConversationBinding{
		ConversationID: event.ConversationID, AgentID: event.AgentID, RuntimeID: runtimeID,
		NativeSessionID: state.SessionID, Generation: 1, State: "ready", EffectiveThinking: state.ThinkingLevel,
		EffectiveCwd: state.Cwd, LastActiveAt: time.Now().UnixMilli(),
	}
	if state.IsStreaming {
		binding.State = "running"
	}
	if state.Model != nil {
		binding.EffectiveProvider = state.Model.Provider
		binding.EffectiveModel = state.Model.ID
	}
	return true, store.UpsertBinding(ctx, binding)
}

func dispatchEmployeeRuns(ctx context.Context, h *hub, store *Store, runs []SequentialRun) {
	for _, run := range runs {
		accepted := h.dispatch("prompt", run.ConversationID, run.Message, []string{run.AgentID}, map[string]string{run.AgentID: run.RunID})
		if len(accepted) != 1 {
			message := "mentioned employee is offline or dispatch failed"
			_ = store.AppendEvent(ctx, run.RunID, "agent_error", nil, message)
			h.broadcast(run.ConversationID, map[string]any{"type": "agent_error", "agentId": run.AgentID, "runId": run.RunID, "error": message})
		} else {
			h.broadcast(run.ConversationID, map[string]any{"type": "inbox_dispatched", "agentId": run.AgentID, "runId": run.RunID})
		}
	}
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	// The browser UI is on 30146 and control is on 30147 during the MVP.
	return parsed.Hostname() == strings.Split(r.Host, ":")[0]
}

func newID(prefix string) string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(value[:])
}

func main() {
	addr := flag.String("addr", "0.0.0.0:30146", "public control and web gateway address")
	webUpstream := flag.String("web-upstream", "http://127.0.0.1:30148", "pi-web upstream URL")
	runtimeToken := flag.String("runtime-token", "multi-agent-dev", "shared MVP runtime token")
	databasePath := flag.String("db", "data/control.db", "SQLite control database path")
	flag.Parse()

	store, err := OpenStore(*databasePath)
	if err != nil {
		log.Fatalf("open control database: %v", err)
	}
	defer store.Close()
	log.Printf("control persistence sqlite=%s mode=WAL", *databasePath)

	h := newHub()
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			stale, err := store.MarkStaleRuntimes(ctx, time.Now().Add(-30*time.Second).UnixMilli())
			cancel()
			if err != nil {
				log.Printf("mark stale runtimes: %v", err)
				continue
			}
			for _, runtimeID := range stale {
				log.Printf("runtime heartbeat stale id=%s", runtimeID)
				h.disconnectRuntime(runtimeID)
			}
		}
	}()
	upgrader := websocket.Upgrader{CheckOrigin: sameOrigin}
	mux := http.NewServeMux()

	mux.HandleFunc("/api/multi-agent/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/api/multi-agent/agents", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		agents, err := store.ListAgents(r.Context())
		if err == nil {
			err = store.PopulateAgentPresence(r.Context(), agents)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"agents": agents})
	})
	mux.HandleFunc("/api/multi-agent/agents/", func(w http.ResponseWriter, r *http.Request) {
		agentID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/multi-agent/agents/"), "/")
		if agentID == "" || strings.Contains(agentID, "/") || r.Method != http.MethodPatch {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var patch AgentConfigPatch
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&patch); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		agent, err := store.UpdateAgentConfig(r.Context(), agentID, patch)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "agent not found", http.StatusNotFound)
			} else {
				http.Error(w, err.Error(), http.StatusBadRequest)
			}
			return
		}
		h.updateAgentConfig(agent)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"agent": agent})
	})
	mux.HandleFunc("/api/multi-agent/runtimes", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		nodes, err := store.ListRuntimeNodes(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"runtimes": nodes})
	})
	mux.HandleFunc("/api/multi-agent/bindings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		conversationID := strings.TrimSpace(r.URL.Query().Get("conversationId"))
		if conversationID == "" {
			http.Error(w, "conversationId required", http.StatusBadRequest)
			return
		}
		bindings, err := store.ListBindings(r.Context(), conversationID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"bindings": bindings})
	})
	mux.HandleFunc("/api/multi-agent/bindings/", func(w http.ResponseWriter, r *http.Request) {
		remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/multi-agent/bindings/"), "/")
		parts := strings.Split(remainder, "/")
		if len(parts) != 3 || parts[2] != "replace" || r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		conversationID, agentID := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		if conversationID == "" || agentID == "" {
			http.Error(w, "conversation and agent required", http.StatusBadRequest)
			return
		}
		if h.activeRun(conversationID, agentID) != "" {
			http.Error(w, "agent has an active run", http.StatusConflict)
			return
		}
		binding, err := store.MarkBindingReplacing(r.Context(), conversationID, agentID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "binding not found", http.StatusNotFound)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		accepted := h.dispatch("replace", conversationID, "", []string{agentID}, nil)
		if len(accepted) != 1 {
			http.Error(w, "runtime offline or replace dispatch failed", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"binding": binding})
	})
	mux.HandleFunc("/api/multi-agent/read-cursors", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			cursor, err := store.GetParticipantCursor(r.Context(), r.URL.Query().Get("conversationId"), r.URL.Query().Get("participantType"), r.URL.Query().Get("participantId"))
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"cursor": cursor})
			return
		}
		if r.Method == http.MethodPost {
			var cursor ParticipantCursor
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&cursor); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			updated, err := store.UpdateParticipantCursor(r.Context(), cursor)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"cursor": updated})
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/multi-agent/inbox", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		agentID := strings.TrimSpace(r.URL.Query().Get("agentId"))
		if agentID == "" {
			http.Error(w, "agentId required", http.StatusBadRequest)
			return
		}
		items, err := store.ListEmployeeInbox(r.Context(), agentID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
	})
	mux.HandleFunc("/api/multi-agent/channels", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			channels, err := store.ListChannels(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"channels": channels})
		case http.MethodPost:
			var input struct {
				Title    string   `json:"title"`
				AgentIDs []string `json:"agentIds"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			channel := Channel{ID: newID("channel"), Title: strings.TrimSpace(input.Title), AgentIDs: input.AgentIDs, CreatedAt: time.Now().UnixMilli()}
			if err := store.CreateChannel(r.Context(), channel); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"channel": channel})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/multi-agent/channels/", func(w http.ResponseWriter, r *http.Request) {
		remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/multi-agent/channels/"), "/")
		parts := strings.Split(remainder, "/")
		channelID := strings.TrimSpace(parts[0])
		if channelID == "" || len(parts) > 2 {
			http.Error(w, "invalid channel id", http.StatusBadRequest)
			return
		}
		if len(parts) == 2 && parts[1] == "turns" && r.Method == http.MethodGet {
			turns, err := store.ConversationTurns(r.Context(), channelID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			cursors, err := store.ConversationCursors(r.Context(), channelID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"turns": turns, "cursors": cursors})
			return
		}
		if len(parts) != 1 {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.Method == http.MethodPatch {
			var input struct {
				Title string `json:"title"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			input.Title = strings.TrimSpace(input.Title)
			if input.Title == "" {
				http.Error(w, "title is required", http.StatusBadRequest)
				return
			}
			if err := store.RenameChannel(r.Context(), channelID, input.Title); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					http.Error(w, "channel not found", http.StatusNotFound)
				} else {
					http.Error(w, err.Error(), http.StatusInternalServerError)
				}
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": channelID, "title": input.Title})
			return
		}
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := store.DeleteChannel(r.Context(), channelID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "channel not found", http.StatusNotFound)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		closed := h.dispatch("close", channelID, "", h.allAgentIDs(), nil)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"closedAgentIds": closed})
	})
	mux.HandleFunc("/api/multi-agent/threads", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			channelID := strings.TrimSpace(r.URL.Query().Get("channelId"))
			if channelID == "" {
				http.Error(w, "channelId required", http.StatusBadRequest)
				return
			}
			threads, err := store.ListThreads(r.Context(), channelID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"threads": threads})
		case http.MethodPost:
			var input struct {
				ChannelID  string `json:"channelId"`
				RootTurnID string `json:"rootTurnId"`
				Title      string `json:"title"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			thread := Thread{ID: newID("thread"), ChannelID: input.ChannelID, RootTurnID: input.RootTurnID, Title: input.Title, CreatedAt: time.Now().UnixMilli()}
			if err := store.CreateThread(r.Context(), thread); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					http.Error(w, "channel not found", http.StatusNotFound)
				} else {
					http.Error(w, err.Error(), http.StatusBadRequest)
				}
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"thread": thread})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/multi-agent/threads/", func(w http.ResponseWriter, r *http.Request) {
		threadID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/multi-agent/threads/"), "/")
		if threadID == "" || strings.Contains(threadID, "/") || r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := store.DeleteThread(r.Context(), threadID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "thread not found", http.StatusNotFound)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		closed := h.dispatch("close", threadID, "", h.allAgentIDs(), nil)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"closedAgentIds": closed})
	})
	mux.HandleFunc("/api/multi-agent/conversations/", func(w http.ResponseWriter, r *http.Request) {
		remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/multi-agent/conversations/"), "/")
		parts := strings.Split(remainder, "/")
		conversationID := strings.TrimSpace(parts[0])
		if conversationID == "" || len(parts) != 2 || r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if parts[1] == "messages" {
			messages, err := store.ConversationMessages(r.Context(), conversationID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			currentVersion, err := store.CurrentConversationVersion(r.Context(), conversationID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"messages": messages, "currentVersion": currentVersion})
			return
		}
		if parts[1] != "turns" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		turns, err := store.ConversationTurns(r.Context(), conversationID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		cursors, err := store.ConversationCursors(r.Context(), conversationID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"turns": turns, "cursors": cursors})
	})
	mux.HandleFunc("/api/multi-agent/runtime/ws", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+*runtimeToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		var registration runtimeRegistration
		if err := conn.ReadJSON(&registration); err != nil || registration.Type != "register" || registration.RuntimeID == "" || registration.InstanceID == "" {
			return
		}
		runtime := &runtimePeer{
			peer:       &peer{conn: conn},
			id:         registration.RuntimeID,
			instanceID: registration.InstanceID,
			name:       registration.Name,
			agents:     registration.Agents,
			activeRuns: registration.ActiveRuns,
		}
		h.registerRuntime(runtime)
		if err := store.UpsertRuntimeNode(r.Context(), registration); err != nil {
			log.Printf("persist runtime node id=%s: %v", runtime.id, err)
		}
		if err := store.UpsertRuntimeAgents(r.Context(), runtime.id, runtime.name, runtime.agents); err != nil {
			log.Printf("persist runtime registration id=%s: %v", runtime.id, err)
		}
		if configuredAgents, err := store.ListAgents(r.Context()); err != nil {
			log.Printf("load configured agents runtime=%s: %v", runtime.id, err)
		} else {
			for _, agent := range configuredAgents {
				h.updateAgentConfig(agent)
			}
		}
		if err := store.ReconcileRuntimeRuns(r.Context(), runtime.id, runtime.activeRuns); err != nil {
			log.Printf("reconcile runtime runs id=%s: %v", runtime.id, err)
		}
		defer func() {
			h.unregisterRuntime(runtime)
			if err := store.SetRuntimeOffline(context.Background(), runtime.id); err != nil {
				log.Printf("persist runtime offline id=%s: %v", runtime.id, err)
			}
		}()
		log.Printf("runtime connected id=%s agents=%d", runtime.id, len(runtime.agents))
		_ = runtime.write(map[string]any{"type": "registered", "runtimeId": runtime.id})
		for {
			var event runtimeEvent
			if err := conn.ReadJSON(&event); err != nil {
				return
			}
			if event.Type == "heartbeat" {
				if err := store.TouchRuntime(r.Context(), runtime.id, runtime.instanceID); err != nil {
					log.Printf("persist heartbeat runtime=%s: %v", runtime.id, err)
					return
				}
				if err := runtime.write(map[string]any{"type": "heartbeat_ack"}); err != nil {
					return
				}
				continue
			}
			if event.ConversationID == "" || event.AgentID == "" || event.RuntimeSeq == 0 {
				continue
			}
			eventType := event.Type
			if event.Type == "agent_event" {
				var inner struct {
					Type  string `json:"type"`
					Error any    `json:"error"`
				}
				if json.Unmarshal(event.Event, &inner) == nil && inner.Type != "" {
					eventType = inner.Type
					if inner.Error != nil && event.Error == "" {
						event.Error = fmt.Sprint(inner.Error)
					}
				}
			}
			if event.RunID == "" && eventType == "session_state" {
				updated, err := persistSessionState(r.Context(), store, runtime.id, event)
				if err != nil {
					log.Printf("persist replacement binding conversation=%s agent=%s: %v", event.ConversationID, event.AgentID, err)
					return
				}
				if err := runtime.write(map[string]any{"type": "event_ack", "runtimeSeq": event.RuntimeSeq}); err != nil {
					return
				}
				if updated {
					h.broadcast(event.ConversationID, map[string]any{"type": "binding_updated", "agentId": event.AgentID})
				}
				continue
			}
			if event.RunID == "" {
				event.RunID = h.activeRun(event.ConversationID, event.AgentID)
			}
			if event.RunID == "" {
				log.Printf("acknowledging runtime event without active run runtime=%s instance=%s seq=%d type=%s", runtime.id, runtime.instanceID, event.RuntimeSeq, event.Type)
				if err := runtime.write(map[string]any{"type": "event_ack", "runtimeSeq": event.RuntimeSeq}); err != nil {
					return
				}
				continue
			}
			h.broadcast(event.ConversationID, map[string]any{
				"type":       event.Type,
				"runtimeId":  runtime.id,
				"instanceId": runtime.instanceID,
				"runtimeSeq": event.RuntimeSeq,
				"runId":      event.RunID,
				"agentId":    event.AgentID,
				"event":      event.Event,
				"error":      event.Error,
				"receivedAt": time.Now().UnixMilli(),
			})
			persisted := queuedEvent{runID: event.RunID, eventType: eventType, payload: event.Event, eventError: event.Error}
			inserted, err := store.AppendRuntimeEvent(r.Context(), runtime.id, runtime.instanceID, event.RuntimeSeq, persisted)
			if err != nil {
				log.Printf("persist runtime event runtime=%s instance=%s seq=%d run=%s type=%s: %v", runtime.id, runtime.instanceID, event.RuntimeSeq, event.RunID, eventType, err)
				return
			}
			if err := runtime.write(map[string]any{"type": "event_ack", "runtimeSeq": event.RuntimeSeq}); err != nil {
				return
			}
			if !inserted {
				continue
			}
			if eventType == "session_state" {
				if _, err := persistSessionState(r.Context(), store, runtime.id, event); err != nil {
					log.Printf("persist binding conversation=%s agent=%s: %v", event.ConversationID, event.AgentID, err)
				}
			}
			if event.RunID != "" && (eventType == "agent_settled" || eventType == "agent_error" || eventType == "host_error") {
				h.clearActiveRun(event.ConversationID, event.AgentID, event.RunID)
				h.broadcast(event.ConversationID, map[string]any{
					"type":      "conversation_committed",
					"runId":     event.RunID,
					"agentId":   event.AgentID,
					"eventType": eventType,
				})
				if eventType == "agent_settled" {
					mentionRuns, mentionErr := store.ClaimMentionRuns(r.Context(), "message-"+event.RunID, 4)
					if mentionErr != nil {
						log.Printf("claim employee inbox source=message-%s: %v", event.RunID, mentionErr)
					}
					dispatchEmployeeRuns(r.Context(), h, store, mentionRuns)
					next, ok, err := store.StartNextSequentialRun(r.Context(), event.RunID)
					if err != nil {
						log.Printf("advance sequential turn run=%s: %v", event.RunID, err)
					} else if ok {
						accepted := h.dispatch("prompt", next.ConversationID, next.Message, []string{next.AgentID}, map[string]string{next.AgentID: next.RunID})
						if len(accepted) != 1 {
							message := "sequential Agent is offline or dispatch failed"
							_ = store.AppendEvent(r.Context(), next.RunID, "agent_error", nil, message)
							h.broadcast(next.ConversationID, map[string]any{"type": "agent_error", "agentId": next.AgentID, "runId": next.RunID, "error": message})
						} else {
							h.broadcast(next.ConversationID, map[string]any{"type": "sequential_dispatched", "agentId": next.AgentID, "runId": next.RunID})
						}
					}
				}
				pendingRuns, pendingErr := store.ClaimPendingEmployeeRuns(r.Context(), event.AgentID, 4)
				if pendingErr != nil {
					log.Printf("claim pending employee inbox agent=%s: %v", event.AgentID, pendingErr)
				} else {
					dispatchEmployeeRuns(r.Context(), h, store, pendingRuns)
				}
			}

		}
	})
	mux.HandleFunc("/api/multi-agent/conversation/ws", func(w http.ResponseWriter, r *http.Request) {
		conversationID := strings.TrimSpace(r.URL.Query().Get("conversationId"))
		if conversationID == "" {
			http.Error(w, "conversationId required", http.StatusBadRequest)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		browser := &browserPeer{peer: &peer{conn: conn}, conversationID: conversationID}
		h.mu.Lock()
		h.browsers[browser] = struct{}{}
		h.mu.Unlock()
		defer func() {
			h.mu.Lock()
			delete(h.browsers, browser)
			h.mu.Unlock()
			_ = conn.Close()
		}()
		_ = browser.write(map[string]any{"type": "connected", "conversationId": conversationID})
		for {
			var command browserCommand
			if err := conn.ReadJSON(&command); err != nil {
				return
			}
			if command.Type != "prompt" && command.Type != "steer" && command.Type != "follow_up" && command.Type != "abort" {
				continue
			}
			if command.Type != "abort" && strings.TrimSpace(command.Message) == "" {
				continue
			}
			dispatchedMessage := command.Message
			if command.Type == "prompt" {
				if command.TurnID == "" {
					command.TurnID = newID("turn")
				}
				if command.CreatedAt == 0 {
					command.CreatedAt = time.Now().UnixMilli()
				}
				if command.RunIDs == nil {
					command.RunIDs = make(map[string]string, len(command.AgentIDs))
				}
				for _, agentID := range command.AgentIDs {
					if command.RunIDs[agentID] == "" {
						command.RunIDs[agentID] = newID("run")
					}
				}
				if err := store.CreateTurnWithMeta(r.Context(), conversationID, command.TurnID, command.Message, command.CreatedAt, command.RunIDs, TurnMessageMeta{
					AuthorType: "member", AuthorID: "local-user", ReplyToTurnID: command.ReplyToTurnID, ReplyToMessageID: command.ReplyToMessageID,
				}); err != nil {
					_ = browser.write(map[string]any{"type": "persistence_error", "turnId": command.TurnID, "error": err.Error()})
					continue
				}
				if command.ExecutionMode == "sequential" && len(command.AgentIDs) > 1 {
					if err := store.ConfigureSequentialTurn(r.Context(), command.TurnID, command.AgentIDs, command.RunIDs); err != nil {
						_ = browser.write(map[string]any{"type": "persistence_error", "turnId": command.TurnID, "error": err.Error()})
						continue
					}
				}
				var err error
				dispatchedMessage, err = store.PromptForConversation(r.Context(), conversationID, command.TurnID, command.Message)
				if err != nil {
					_ = browser.write(map[string]any{"type": "persistence_error", "turnId": command.TurnID, "error": err.Error()})
					continue
				}
			}
			dispatchAgentIDs := command.AgentIDs
			if command.Type == "prompt" && command.ExecutionMode == "sequential" && len(command.AgentIDs) > 1 {
				dispatchAgentIDs = command.AgentIDs[:1]
			}
			accepted := h.dispatch(command.Type, conversationID, dispatchedMessage, dispatchAgentIDs, command.RunIDs)
			if command.Type == "prompt" {
				acceptedSet := make(map[string]struct{}, len(accepted))
				for _, agentID := range accepted {
					acceptedSet[agentID] = struct{}{}
				}
				for _, agentID := range dispatchAgentIDs {
					runID := command.RunIDs[agentID]
					if _, ok := acceptedSet[agentID]; ok {
						continue
					}
					message := "agent is offline or dispatch failed"
					if err := store.AppendEvent(r.Context(), runID, "agent_error", nil, message); err != nil {
						log.Printf("persist dispatch failure run=%s: %v", runID, err)
					}
					_ = browser.write(map[string]any{"type": "agent_error", "agentId": agentID, "runId": runID, "error": message})
				}
			}
			_ = browser.write(map[string]any{"type": "dispatched", "turnId": command.TurnID, "agentIds": accepted})
		}
	})

	upstream, err := url.Parse(*webUpstream)
	if err != nil {
		log.Fatalf("invalid web upstream: %v", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("pi-web proxy error: %v", err)
		http.Error(w, "pi-web is starting", http.StatusBadGateway)
	}
	mux.Handle("/", proxy)

	server := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("public gateway listening on %s, pi-web upstream=%s", *addr, upstream)
	log.Fatal(server.ListenAndServe())
}
