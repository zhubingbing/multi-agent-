package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"

	"multi-agent/internal/host"
)

type agentInfo struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Provider        string `json:"provider"`
	Cwd             string `json:"cwd"`
	DesiredProvider string `json:"desiredProvider,omitempty"`
	DesiredModel    string `json:"desiredModel,omitempty"`
	DesiredThinking string `json:"desiredThinkingLevel,omitempty"`
	DesiredCwd      string `json:"desiredCwd,omitempty"`
}

type command struct {
	Type           string `json:"type"`
	RuntimeSeq     uint64 `json:"runtimeSeq"`
	RequestID      string `json:"requestId"`
	RunID          string `json:"runId"`
	ConversationID string `json:"conversationId"`
	AgentID        string `json:"agentId"`
	Message        string `json:"message"`
	Cwd            string `json:"cwd"`
	Model          string `json:"model"`
	ThinkingLevel  string `json:"thinkingLevel"`
}

type activeRunInfo struct {
	ConversationID string `json:"conversationId"`
	AgentID        string `json:"agentId"`
	RunID          string `json:"runId"`
}

type outboundRuntimeEvent struct {
	Type           string          `json:"type"`
	RuntimeSeq     uint64          `json:"runtimeSeq"`
	RunID          string          `json:"runId"`
	ConversationID string          `json:"conversationId"`
	AgentID        string          `json:"agentId"`
	RequestID      string          `json:"requestId,omitempty"`
	Event          json.RawMessage `json:"event,omitempty"`
	Error          string          `json:"error,omitempty"`
}

type sessionRoute struct {
	conversationID string
	agentID        string
	runID          string
}

type wsWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (w *wsWriter) write(value any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteJSON(value)
}

type eventRelay struct {
	mu      sync.Mutex
	nextSeq uint64
	active  *wsWriter
	pending map[uint64]outboundRuntimeEvent
}

func newEventRelay() *eventRelay {
	return &eventRelay{pending: make(map[uint64]outboundRuntimeEvent)}
}

func (r *eventRelay) enqueue(event outboundRuntimeEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextSeq++
	event.RuntimeSeq = r.nextSeq
	r.pending[event.RuntimeSeq] = event
	if r.active != nil {
		_ = r.active.write(event)
	}
}

func (r *eventRelay) attach(writer *wsWriter) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.active = writer
	for seq := uint64(1); seq <= r.nextSeq; seq++ {
		if event, ok := r.pending[seq]; ok {
			if err := writer.write(event); err != nil {
				r.active = nil
				return err
			}
		}
	}
	return nil
}

func (r *eventRelay) detach(writer *wsWriter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active == writer {
		r.active = nil
	}
}

func (r *eventRelay) acknowledge(seq uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.pending, seq)
}

func (r *eventRelay) pendingCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pending)
}

func main() {
	serverURL := flag.String("server", envOr("MULTI_AGENT_SERVER_URL", "ws://127.0.0.1:30146/api/multi-agent/runtime/ws"), "control server websocket URL")
	token := flag.String("token", envOr("MULTI_AGENT_RUNTIME_TOKEN", "multi-agent-dev"), "runtime token")
	runtimeID := flag.String("runtime-id", envOr("MULTI_AGENT_RUNTIME_ID", "runtime-host"), "runtime ID")
	runtimeName := flag.String("runtime-name", envOr("MULTI_AGENT_RUNTIME_NAME", "Host Runtime"), "runtime display name")
	runtimeVersion := flag.String("runtime-version", envOr("MULTI_AGENT_RUNTIME_VERSION", "dev"), "runtime software version")
	piVersion := flag.String("pi-version", versionFromEnvironment(), "Pi SDK version")
	agentID := flag.String("agent-id", envOr("MULTI_AGENT_AGENT_ID", "host-pi"), "agent ID")
	agentName := flag.String("agent-name", envOr("MULTI_AGENT_AGENT_NAME", "Host Pi"), "agent display name")
	cwd := flag.String("cwd", envOr("MULTI_AGENT_AGENT_CWD", "."), "agent working directory")
	root := flag.String("root", envOr("MULTI_AGENT_ROOT", "."), "multi-agent project root")
	flag.Parse()

	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		log.Fatal(err)
	}
	absoluteCwd, err := filepath.Abs(*cwd)
	if err != nil {
		log.Fatal(err)
	}
	hostScript := envOr("MULTI_AGENT_PI_HOST", filepath.Join(absoluteRoot, "services", "pi-host", "dist", "index.js"))
	dataDir := envOr("MULTI_AGENT_DATA_DIR", filepath.Join(absoluteRoot, "data", "runtimes", *runtimeID))

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	piHost, err := host.Start(ctx, envOr("NODE_BINARY", "node"), hostScript, dataDir)
	if err != nil {
		log.Fatalf("start Pi SDK host: %v", err)
	}
	defer piHost.Close()
	go func() {
		select {
		case <-piHost.Done():
			if ctx.Err() == nil {
				log.Printf("Pi SDK host exited unexpectedly: %v; terminating runtime for supervisor restart", piHost.Err())
				os.Exit(70)
			}
		case <-ctx.Done():
		}
	}()

	routes := sync.Map{}
	relay := newEventRelay()
	instanceID := randomID()
	nodeVersion := commandVersion(envOr("NODE_BINARY", "node"))
	unsubscribe := piHost.Subscribe(func(envelope host.Envelope) {
		value, ok := routes.Load(envelope.SessionKey)
		if !ok {
			return
		}
		route := value.(sessionRoute)
		if envelope.RunID == "" {
			return
		}
		relay.enqueue(outboundRuntimeEvent{
			Type:           "agent_event",
			RunID:          envelope.RunID,
			ConversationID: route.conversationID,
			AgentID:        route.agentID,
			Event:          json.RawMessage(envelope.Event),
		})
		var event struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(envelope.Event, &event) == nil && (event.Type == "agent_settled" || event.Type == "host_error") {
			routes.CompareAndSwap(envelope.SessionKey, route, sessionRoute{conversationID: route.conversationID, agentID: route.agentID})
		}
	})
	defer unsubscribe()

	backoff := time.Second
	for ctx.Err() == nil {
		header := http.Header{"Authorization": []string{"Bearer " + *token}}
		conn, _, err := websocket.DefaultDialer.DialContext(ctx, *serverURL, header)
		if err != nil {
			log.Printf("control connect failed: %v; retrying in %s", err, backoff)
			sleepContext(ctx, backoff)
			if backoff < 15*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		writer := &wsWriter{conn: conn}
		registration := map[string]any{
			"type":         "register",
			"runtimeId":    *runtimeID,
			"instanceId":   instanceID,
			"name":         *runtimeName,
			"version":      *runtimeVersion,
			"nodeVersion":  nodeVersion,
			"piVersion":    *piVersion,
			"os":           goruntime.GOOS,
			"architecture": goruntime.GOARCH,
			"capabilities": map[string]bool{
				"pi.session": true, "prompt": true, "steer": true, "followUp": true,
				"abort": true, "session.restore": true,
			},
			"agents": []agentInfo{{
				ID: *agentID, Name: *agentName, Provider: "pi", Cwd: absoluteCwd,
				DesiredProvider: envOr("PI_PROVIDER", ""), DesiredModel: envOr("PI_MODEL", ""),
				DesiredThinking: envOr("PI_REASONING_LEVEL", ""), DesiredCwd: absoluteCwd,
			}},
			"activeRuns": reconciliationRunSnapshot(&routes, relay),
		}
		if err := writer.write(registration); err != nil {
			_ = conn.Close()
			continue
		}
		if err := relay.attach(writer); err != nil {
			_ = conn.Close()
			continue
		}
		log.Printf("connected runtime=%s instance=%s agent=%s cwd=%s pending_events=%d", *runtimeID, instanceID, *agentID, absoluteCwd, relay.pendingCount())
		heartbeatDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := writer.write(map[string]any{"type": "heartbeat"}); err != nil {
						_ = conn.Close()
						return
					}
				case <-heartbeatDone:
					return
				case <-ctx.Done():
					return
				}
			}
		}()

		for {
			var cmd command
			if err := conn.ReadJSON(&cmd); err != nil {
				log.Printf("control disconnected: %v", err)
				break
			}
			if cmd.Type == "event_ack" {
				relay.acknowledge(cmd.RuntimeSeq)
				continue
			}
			if (cmd.Type != "prompt" && cmd.Type != "steer" && cmd.Type != "follow_up" && cmd.Type != "abort" && cmd.Type != "close" && cmd.Type != "replace") || cmd.AgentID != *agentID {
				continue
			}
			go runCommand(ctx, piHost, relay, cmd, &routes, absoluteCwd)
		}
		close(heartbeatDone)
		relay.detach(writer)
		_ = conn.Close()
	}
}

func runCommand(ctx context.Context, piHost *host.Client, relay *eventRelay, cmd command, routes *sync.Map, defaultCwd string) {
	sessionKey := cmd.ConversationID + "::" + cmd.AgentID
	if cmd.Type == "prompt" && !reserveSessionRun(routes, sessionKey, sessionRoute{
		conversationID: cmd.ConversationID,
		agentID:        cmd.AgentID,
		runID:          cmd.RunID,
	}) {
		reportError(relay, cmd, fmt.Errorf("prompt: session already has an active run"))
		return
	}
	effectiveCwd := strings.TrimSpace(cmd.Cwd)
	if effectiveCwd == "" {
		effectiveCwd = defaultCwd
	}
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var opened map[string]any
	if cmd.Type == "prompt" {
		if err := piHost.Call(callCtx, "session.open", map[string]any{
			"sessionKey":    sessionKey,
			"cwd":           effectiveCwd,
			"model":         cmd.Model,
			"thinkingLevel": cmd.ThinkingLevel,
		}, &opened); err != nil {
			releaseSessionRun(routes, sessionKey, cmd.RunID)
			reportError(relay, cmd, fmt.Errorf("open session: %w", err))
			return
		}
		opened["type"] = "session_state"
		stateEvent, err := json.Marshal(opened)
		if err != nil {
			releaseSessionRun(routes, sessionKey, cmd.RunID)
			reportError(relay, cmd, fmt.Errorf("encode session state: %w", err))
			return
		}
		relay.enqueue(outboundRuntimeEvent{
			Type: "agent_event", RunID: cmd.RunID, ConversationID: cmd.ConversationID, AgentID: cmd.AgentID, Event: stateEvent,
		})
	}
	method := map[string]string{
		"prompt":    "session.prompt",
		"steer":     "session.steer",
		"follow_up": "session.followUp",
		"abort":     "session.abort",
		"close":     "session.close",
		"replace":   "session.replace",
	}[cmd.Type]
	params := map[string]any{"sessionKey": sessionKey}
	if cmd.Type == "replace" {
		params["cwd"] = effectiveCwd
		params["model"] = cmd.Model
		params["thinkingLevel"] = cmd.ThinkingLevel
	}
	if cmd.Type == "prompt" {
		params["runId"] = cmd.RunID
	}
	if cmd.Type != "abort" && cmd.Type != "close" && cmd.Type != "replace" {
		params["message"] = cmd.Message
	}
	var result any
	if err := piHost.Call(callCtx, method, params, &result); err != nil {
		if cmd.Type == "prompt" {
			releaseSessionRun(routes, sessionKey, cmd.RunID)
		}
		reportError(relay, cmd, fmt.Errorf("%s: %w", cmd.Type, err))
		return
	}
	if cmd.Type == "replace" {
		state, ok := result.(map[string]any)
		if !ok {
			encoded, _ := json.Marshal(result)
			_ = json.Unmarshal(encoded, &state)
		}
		state["type"] = "session_state"
		stateEvent, err := json.Marshal(state)
		if err != nil {
			log.Printf("encode replaced session state conversation=%s agent=%s: %v", cmd.ConversationID, cmd.AgentID, err)
			return
		}
		relay.enqueue(outboundRuntimeEvent{
			Type: "agent_event", ConversationID: cmd.ConversationID, AgentID: cmd.AgentID, Event: stateEvent,
		})
	}
	if cmd.RunID != "" {
		relay.enqueue(outboundRuntimeEvent{
			Type:           "command_accepted",
			RunID:          cmd.RunID,
			ConversationID: cmd.ConversationID,
			AgentID:        cmd.AgentID,
			RequestID:      cmd.RequestID,
		})
	}
}

func reportError(relay *eventRelay, cmd command, err error) {
	if cmd.RunID == "" {
		log.Printf("%s command failed without active run conversation=%s agent=%s: %v", cmd.Type, cmd.ConversationID, cmd.AgentID, err)
		return
	}
	relay.enqueue(outboundRuntimeEvent{
		Type:           "agent_error",
		RunID:          cmd.RunID,
		ConversationID: cmd.ConversationID,
		AgentID:        cmd.AgentID,
		RequestID:      cmd.RequestID,
		Error:          err.Error(),
	})
}

func reserveSessionRun(routes *sync.Map, sessionKey string, desired sessionRoute) bool {
	if desired.runID == "" {
		return false
	}
	for {
		currentValue, loaded := routes.LoadOrStore(sessionKey, desired)
		if !loaded {
			return true
		}
		current, ok := currentValue.(sessionRoute)
		if !ok || current.runID != "" {
			return ok && current.runID == desired.runID
		}
		if routes.CompareAndSwap(sessionKey, current, desired) {
			return true
		}
	}
}

func releaseSessionRun(routes *sync.Map, sessionKey, runID string) {
	currentValue, ok := routes.Load(sessionKey)
	if !ok {
		return
	}
	current, ok := currentValue.(sessionRoute)
	if !ok || current.runID != runID {
		return
	}
	routes.CompareAndSwap(sessionKey, current, sessionRoute{conversationID: current.conversationID, agentID: current.agentID})
}

func reconciliationRunSnapshot(routes *sync.Map, relay *eventRelay) []activeRunInfo {
	result := activeRunSnapshot(routes)
	seen := make(map[string]struct{}, len(result))
	for _, active := range result {
		seen[active.RunID] = struct{}{}
	}
	relay.mu.Lock()
	defer relay.mu.Unlock()
	for _, event := range relay.pending {
		if event.RunID == "" || event.ConversationID == "" || event.AgentID == "" {
			continue
		}
		if _, ok := seen[event.RunID]; ok {
			continue
		}
		seen[event.RunID] = struct{}{}
		result = append(result, activeRunInfo{
			ConversationID: event.ConversationID,
			AgentID:        event.AgentID,
			RunID:          event.RunID,
		})
	}
	return result
}

func activeRunSnapshot(routes *sync.Map) []activeRunInfo {
	result := []activeRunInfo{}
	routes.Range(func(_, value any) bool {
		route, ok := value.(sessionRoute)
		if ok && route.conversationID != "" && route.agentID != "" && route.runID != "" {
			result = append(result, activeRunInfo{
				ConversationID: route.conversationID,
				AgentID:        route.agentID,
				RunID:          route.runID,
			})
		}
		return true
	})
	return result
}

func versionFromEnvironment() string {
	if version := strings.TrimSpace(os.Getenv("MULTI_AGENT_PI_VERSION")); version != "" && version != "unknown" {
		return version
	}
	if path := strings.TrimSpace(os.Getenv("MULTI_AGENT_PI_VERSION_FILE")); path != "" {
		if content, err := os.ReadFile(path); err == nil && strings.TrimSpace(string(content)) != "" {
			return strings.TrimSpace(string(content))
		}
	}
	return "unknown"
}

func commandVersion(binary string) string {
	output, err := exec.Command(binary, "--version").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}

func randomID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func sleepContext(ctx context.Context, duration time.Duration) {
	select {
	case <-time.After(duration):
	case <-ctx.Done():
	}
}
