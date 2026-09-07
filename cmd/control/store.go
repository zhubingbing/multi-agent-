package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
)

type Channel struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	WorkspaceID string   `json:"workspaceId"`
	AgentIDs    []string `json:"agentIds"`
	CreatedAt   int64    `json:"createdAt"`
}

const defaultWorkspaceID = "workspace-default"

type Workspace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Cwd       string `json:"cwd"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type ParticipantCursor struct {
	ConversationID  string `json:"conversationId"`
	ParticipantType string `json:"participantType"`
	ParticipantID   string `json:"participantId"`
	LastSeenVersion int64  `json:"lastSeenVersion"`
	UpdatedAt       int64  `json:"updatedAt"`
}

type ConversationBinding struct {
	ConversationID    string `json:"conversationId"`
	AgentID           string `json:"agentId"`
	RuntimeID         string `json:"runtimeId"`
	NativeSessionID   string `json:"nativeSessionId"`
	Generation        int64  `json:"generation"`
	State             string `json:"state"`
	EffectiveProvider string `json:"effectiveProvider,omitempty"`
	EffectiveModel    string `json:"effectiveModel,omitempty"`
	EffectiveThinking string `json:"effectiveThinkingLevel,omitempty"`
	EffectiveCwd      string `json:"effectiveCwd,omitempty"`
	LastActiveAt      int64  `json:"lastActiveAt"`
}

type RuntimeNode struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	Status         string             `json:"status"`
	ControlState   string             `json:"controlState"`
	InstanceID     string             `json:"instanceId,omitempty"`
	Version        string             `json:"version,omitempty"`
	NodeVersion    string             `json:"nodeVersion,omitempty"`
	PiVersion      string             `json:"piVersion,omitempty"`
	OS             string             `json:"os,omitempty"`
	Architecture   string             `json:"architecture,omitempty"`
	Capabilities   json.RawMessage    `json:"capabilities"`
	Models         []runtimeModelInfo `json:"-"`
	Skills         []runtimeSkillInfo `json:"-"`
	Tools          []runtimeToolInfo  `json:"-"`
	MCPServers     []map[string]any   `json:"-"`
	MCPSupported   bool               `json:"mcpSupported"`
	InventoryError string             `json:"inventoryError,omitempty"`
	InventoryAt    int64              `json:"inventoryAt,omitempty"`
	LastSeenAt     int64              `json:"lastSeenAt"`
	ConfigVersion  int64              `json:"configVersion"`
}

type AgentConfigPatch struct {
	Name            string `json:"name"`
	Handle          string `json:"handle"`
	Description     string `json:"description"`
	Instructions    string `json:"instructions"`
	DesiredProvider string `json:"desiredProvider"`
	DesiredModel    string `json:"desiredModel"`
	DesiredThinking string `json:"desiredThinkingLevel"`
	DesiredCwd      string `json:"desiredCwd"`
}

type Thread struct {
	ID         string `json:"id"`
	ChannelID  string `json:"channelId"`
	RootTurnID string `json:"rootTurnId,omitempty"`
	RootText   string `json:"rootText,omitempty"`
	Title      string `json:"title"`
	CreatedAt  int64  `json:"createdAt"`
}

type StoredRun struct {
	ID             string            `json:"id"`
	AgentID        string            `json:"agentId"`
	Status         string            `json:"status"`
	FinalMessageID string            `json:"finalMessageId,omitempty"`
	Messages       []json.RawMessage `json:"messages"`
	Settled        bool              `json:"settled"`
	Error          string            `json:"error,omitempty"`
}

type StoredTurn struct {
	ID   string         `json:"id"`
	User map[string]any `json:"user"`
	Runs []StoredRun    `json:"runs"`
}

type EmployeeInbox struct {
	ID               string `json:"id"`
	RecipientAgentID string `json:"recipientAgentId"`
	SourceMessageID  string `json:"sourceMessageId"`
	State            string `json:"state"`
	Reason           string `json:"reason,omitempty"`
	CreatedAt        int64  `json:"createdAt"`
	ConsumedAt       int64  `json:"consumedAt,omitempty"`
}

type SequentialRun struct {
	ConversationID string
	TurnID         string
	RunID          string
	AgentID        string
	Message        string
}

type TurnMessageMeta struct {
	AuthorType       string
	AuthorID         string
	ReplyToTurnID    string
	ReplyToMessageID string
}

type RuntimeCursor struct {
	RuntimeID  string `json:"runtimeId"`
	InstanceID string `json:"instanceId"`
	Sequence   uint64 `json:"sequence"`
}

type PublicMessage struct {
	ID               string          `json:"id"`
	ConversationID   string          `json:"conversationId"`
	TurnID           string          `json:"turnId"`
	Version          int64           `json:"version"`
	AuthorType       string          `json:"authorType"`
	AuthorID         string          `json:"authorId"`
	RunID            string          `json:"runId,omitempty"`
	ReplyToMessageID string          `json:"replyToMessageId,omitempty"`
	Mentions         []string        `json:"mentions"`
	Content          json.RawMessage `json:"content"`
	CreatedAt        int64           `json:"createdAt"`
}

type Store struct {
	db      *sql.DB
	eventMu sync.Mutex
}

func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	dsn := "file:" + filepath.ToSlash(path) + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	store := &Store{db: db}
	if err := store.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) initialize(ctx context.Context) error {
	statements := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA synchronous=NORMAL`,
		`PRAGMA foreign_keys=ON`,
		`PRAGMA busy_timeout=5000`,
		`CREATE TABLE IF NOT EXISTS runtime_nodes (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'offline',
			control_state TEXT NOT NULL DEFAULT 'active',
			instance_id TEXT NOT NULL DEFAULT '',
			version TEXT NOT NULL DEFAULT '',
			node_version TEXT NOT NULL DEFAULT '',
			pi_version TEXT NOT NULL DEFAULT '',
			os TEXT NOT NULL DEFAULT '',
			architecture TEXT NOT NULL DEFAULT '',
			capabilities_json BLOB NOT NULL DEFAULT '{}',
			models_json BLOB NOT NULL DEFAULT '[]',
			skills_json BLOB NOT NULL DEFAULT '[]',
			tools_json BLOB NOT NULL DEFAULT '[]',
			mcp_json BLOB NOT NULL DEFAULT '[]',
			mcp_supported INTEGER NOT NULL DEFAULT 0,
			inventory_error TEXT NOT NULL DEFAULT '',
			inventory_at INTEGER NOT NULL DEFAULT 0,
			last_seen_at INTEGER NOT NULL,
			config_version INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_pairing_tokens (
			id TEXT PRIMARY KEY,
			token_hash TEXT NOT NULL UNIQUE,
			expires_at INTEGER NOT NULL,
			used_at INTEGER,
			revoked_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_credentials (
			id TEXT PRIMARY KEY,
			runtime_id TEXT NOT NULL,
			credential_hash TEXT NOT NULL UNIQUE,
			created_at INTEGER NOT NULL,
			last_used_at INTEGER,
			revoked_at INTEGER
		)`,
		`CREATE INDEX IF NOT EXISTS runtime_credentials_runtime ON runtime_credentials(runtime_id)`,
		`CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			provider TEXT NOT NULL,
			runtime_id TEXT NOT NULL,
			runtime_name TEXT NOT NULL,
			cwd TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'offline',
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			cwd TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			deleted_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS channels (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			workspace_id TEXT NOT NULL DEFAULT 'workspace-default',
			created_at INTEGER NOT NULL,
			deleted_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS channel_agents (
			channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
			agent_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (channel_id, agent_id)
		)`,
		`CREATE TABLE IF NOT EXISTS threads (
			id TEXT PRIMARY KEY,
			channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
			root_turn_id TEXT,
			title TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			deleted_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS turns (
			id TEXT PRIMARY KEY,
			channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
			conversation_id TEXT,
			author_type TEXT NOT NULL DEFAULT 'member',
			author_id TEXT NOT NULL DEFAULT 'local-user',
			reply_to_turn_id TEXT,
			reply_to_message_id TEXT,
			execution_mode TEXT NOT NULL DEFAULT 'parallel',
			message TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runs (
			id TEXT PRIMARY KEY,
			turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			agent_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'running',
			error TEXT NOT NULL DEFAULT '',
			dispatch_order INTEGER NOT NULL DEFAULT 0,
			trigger_message_id TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS conversation_agent_bindings (
			conversation_id TEXT NOT NULL,
			agent_id TEXT NOT NULL,
			runtime_id TEXT NOT NULL,
			native_session_id TEXT NOT NULL,
			generation INTEGER NOT NULL DEFAULT 1,
			state TEXT NOT NULL,
			effective_provider TEXT NOT NULL DEFAULT '',
			effective_model TEXT NOT NULL DEFAULT '',
			effective_thinking_level TEXT NOT NULL DEFAULT '',
			effective_cwd TEXT NOT NULL DEFAULT '',
			last_active_at INTEGER NOT NULL,
			PRIMARY KEY (conversation_id,agent_id)
		)`,
		`CREATE TABLE IF NOT EXISTS conversation_states (
			conversation_id TEXT PRIMARY KEY,
			current_version INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS participant_read_cursors (
			conversation_id TEXT NOT NULL,
			participant_type TEXT NOT NULL,
			participant_id TEXT NOT NULL,
			last_seen_version INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (conversation_id,participant_type,participant_id)
		)`,
		`CREATE TABLE IF NOT EXISTS conversation_messages (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			version INTEGER NOT NULL DEFAULT 0,
			author_type TEXT NOT NULL,
			author_id TEXT NOT NULL,
			run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
			reply_to_message_id TEXT,
			content_json BLOB NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS message_mentions (
			message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
			agent_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (message_id,agent_id)
		)`,
		`CREATE TABLE IF NOT EXISTS employee_inbox (
			id TEXT PRIMARY KEY,
			recipient_agent_id TEXT NOT NULL,
			source_message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
			state TEXT NOT NULL DEFAULT 'queued',
			reason TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			consumed_at INTEGER,
			UNIQUE (recipient_agent_id,source_message_id)
		)`,
		`CREATE TABLE IF NOT EXISTS events (
			run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
			seq INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload_json BLOB,
			error TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			PRIMARY KEY (run_id, seq)
		)`,
		`CREATE INDEX IF NOT EXISTS conversation_messages_timeline ON conversation_messages(conversation_id,created_at,id)`,
		`CREATE TABLE IF NOT EXISTS runtime_event_receipts (
			runtime_id TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			runtime_seq INTEGER NOT NULL,
			run_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (runtime_id, instance_id, runtime_seq)
		)`,
		`CREATE INDEX IF NOT EXISTS threads_channel_created ON threads(channel_id, created_at, id)`,
		`CREATE INDEX IF NOT EXISTS turns_channel_created ON turns(channel_id, created_at, id)`,
		`CREATE INDEX IF NOT EXISTS runs_turn_created ON runs(turn_id, created_at, id)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize sqlite: %w", err)
		}
	}
	if err := s.ensureRuntimeNodeColumns(ctx); err != nil {
		return err
	}
	if err := s.ensureRunColumns(ctx); err != nil {
		return err
	}
	if err := s.ensureAgentConfigColumns(ctx); err != nil {
		return err
	}
	if err := s.ensureConversationMessageColumns(ctx); err != nil {
		return err
	}
	if err := s.initializeConversationVersions(ctx); err != nil {
		return err
	}
	if err := s.ensureTurnColumns(ctx); err != nil {
		return err
	}
	if err := s.ensureWorkspaceSchema(ctx); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE agents SET status='offline'`); err != nil {
		return fmt.Errorf("reset persisted agent presence: %w", err)
	}
	if err := s.seedDefaultWorkspace(ctx); err != nil {
		return err
	}
	return s.seedDefaultChannels(ctx)
}

func (s *Store) ensureWorkspaceSchema(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(channels)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return err
		}
		found = found || name == "workspace_id"
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if !found {
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE channels ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace-default'`); err != nil {
			return fmt.Errorf("add channel workspace_id: %w", err)
		}
	}
	_, err = s.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS channels_workspace_created ON channels(workspace_id,created_at,id)`)
	return err
}

func (s *Store) seedDefaultWorkspace(ctx context.Context) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO workspaces(id,name,cwd,created_at,updated_at) VALUES(?,?,?,?,?)`, defaultWorkspaceID, "默认工作空间", "", now, now)
	return err
}

func (s *Store) initializeConversationVersions(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE conversation_messages SET version=rowid WHERE version=0`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO conversation_states(conversation_id,current_version,updated_at)
		SELECT conversation_id,MAX(version),? FROM conversation_messages GROUP BY conversation_id
		ON CONFLICT(conversation_id) DO UPDATE SET current_version=MAX(conversation_states.current_version,excluded.current_version),updated_at=excluded.updated_at`,
		time.Now().UnixMilli())
	return err
}

func nextConversationVersion(ctx context.Context, tx *sql.Tx, conversationID string) (int64, error) {
	now := time.Now().UnixMilli()
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO conversation_states(conversation_id,current_version,updated_at) VALUES(?,0,?)`, conversationID, now); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversation_states SET current_version=current_version+1,updated_at=? WHERE conversation_id=?`, now, conversationID); err != nil {
		return 0, err
	}
	var version int64
	if err := tx.QueryRowContext(ctx, `SELECT current_version FROM conversation_states WHERE conversation_id=?`, conversationID).Scan(&version); err != nil {
		return 0, err
	}
	return version, nil
}

func (s *Store) CurrentConversationVersion(ctx context.Context, conversationID string) (int64, error) {
	var version int64
	err := s.db.QueryRowContext(ctx, `SELECT current_version FROM conversation_states WHERE conversation_id=?`, conversationID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return version, err
}

func (s *Store) UpdateParticipantCursor(ctx context.Context, cursor ParticipantCursor) (ParticipantCursor, error) {
	if cursor.ConversationID == "" || cursor.ParticipantID == "" || (cursor.ParticipantType != "member" && cursor.ParticipantType != "agent") {
		return ParticipantCursor{}, errors.New("valid conversation and participant are required")
	}
	current, err := s.CurrentConversationVersion(ctx, cursor.ConversationID)
	if err != nil {
		return ParticipantCursor{}, err
	}
	if cursor.LastSeenVersion < 0 || cursor.LastSeenVersion > current {
		return ParticipantCursor{}, errors.New("last seen version is outside the Conversation")
	}
	cursor.UpdatedAt = time.Now().UnixMilli()
	_, err = s.db.ExecContext(ctx, `INSERT INTO participant_read_cursors
		(conversation_id,participant_type,participant_id,last_seen_version,updated_at) VALUES(?,?,?,?,?)
		ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET
		last_seen_version=MAX(participant_read_cursors.last_seen_version,excluded.last_seen_version),updated_at=excluded.updated_at`,
		cursor.ConversationID, cursor.ParticipantType, cursor.ParticipantID, cursor.LastSeenVersion, cursor.UpdatedAt)
	if err != nil {
		return ParticipantCursor{}, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT last_seen_version,updated_at FROM participant_read_cursors
		WHERE conversation_id=? AND participant_type=? AND participant_id=?`, cursor.ConversationID, cursor.ParticipantType, cursor.ParticipantID).
		Scan(&cursor.LastSeenVersion, &cursor.UpdatedAt); err != nil {
		return ParticipantCursor{}, err
	}
	return cursor, nil
}

func (s *Store) GetParticipantCursor(ctx context.Context, conversationID, participantType, participantID string) (ParticipantCursor, error) {
	cursor := ParticipantCursor{ConversationID: conversationID, ParticipantType: participantType, ParticipantID: participantID}
	err := s.db.QueryRowContext(ctx, `SELECT last_seen_version,updated_at FROM participant_read_cursors
		WHERE conversation_id=? AND participant_type=? AND participant_id=?`, conversationID, participantType, participantID).
		Scan(&cursor.LastSeenVersion, &cursor.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return cursor, nil
	}
	return cursor, err
}

func (s *Store) ensureRuntimeNodeColumns(ctx context.Context) error {
	columns := map[string]string{
		"control_state": "TEXT NOT NULL DEFAULT 'active'", "models_json": "BLOB NOT NULL DEFAULT '[]'",
		"skills_json": "BLOB NOT NULL DEFAULT '[]'", "tools_json": "BLOB NOT NULL DEFAULT '[]'", "mcp_json": "BLOB NOT NULL DEFAULT '[]'",
		"mcp_supported": "INTEGER NOT NULL DEFAULT 0", "inventory_error": "TEXT NOT NULL DEFAULT ''", "inventory_at": "INTEGER NOT NULL DEFAULT 0",
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(runtime_nodes)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		found[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for name, definition := range columns {
		if found[name] {
			continue
		}
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE runtime_nodes ADD COLUMN `+name+` `+definition); err != nil {
			return fmt.Errorf("add runtime node %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) ensureRunColumns(ctx context.Context) error {
	columns := map[string]string{
		"dispatch_order":     "INTEGER NOT NULL DEFAULT 0",
		"trigger_message_id": "TEXT",
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(runs)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if _, ok := columns[name]; ok {
			found[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for name, definition := range columns {
		if found[name] {
			continue
		}
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE runs ADD COLUMN `+name+` `+definition); err != nil {
			return fmt.Errorf("add runs %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) ensureAgentConfigColumns(ctx context.Context) error {
	columns := map[string]string{
		"handle":                 "TEXT NOT NULL DEFAULT ''",
		"description":            "TEXT NOT NULL DEFAULT ''",
		"instructions":           "TEXT NOT NULL DEFAULT ''",
		"desired_provider":       "TEXT NOT NULL DEFAULT ''",
		"desired_model":          "TEXT NOT NULL DEFAULT ''",
		"desired_thinking_level": "TEXT NOT NULL DEFAULT ''",
		"desired_cwd":            "TEXT NOT NULL DEFAULT ''",
		"config_version":         "INTEGER NOT NULL DEFAULT 1",
		"archived_at":            "INTEGER",
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(agents)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if _, ok := columns[name]; ok {
			found[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for name, definition := range columns {
		if found[name] {
			continue
		}
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE agents ADD COLUMN `+name+` `+definition); err != nil {
			return fmt.Errorf("add agents %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) ensureConversationMessageColumns(ctx context.Context) error {
	columns := map[string]string{
		"reply_to_message_id": "TEXT",
		"version":             "INTEGER NOT NULL DEFAULT 0",
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(conversation_messages)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if _, ok := columns[name]; ok {
			found[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for name, definition := range columns {
		if found[name] {
			continue
		}
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE conversation_messages ADD COLUMN `+name+` `+definition); err != nil {
			return fmt.Errorf("add conversation_messages %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) ensureTurnColumns(ctx context.Context) error {
	columns := map[string]string{
		"conversation_id":     "TEXT",
		"author_type":         "TEXT NOT NULL DEFAULT 'member'",
		"author_id":           "TEXT NOT NULL DEFAULT 'local-user'",
		"reply_to_turn_id":    "TEXT",
		"reply_to_message_id": "TEXT",
		"execution_mode":      "TEXT NOT NULL DEFAULT 'parallel'",
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(turns)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if _, ok := columns[name]; ok {
			found[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for name, definition := range columns {
		if found[name] {
			continue
		}
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE turns ADD COLUMN `+name+` `+definition); err != nil {
			return fmt.Errorf("add turns %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) MarkBindingReplacing(ctx context.Context, conversationID, agentID string) (ConversationBinding, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE conversation_agent_bindings SET generation=generation+1,state='replacing',last_active_at=?
		WHERE conversation_id=? AND agent_id=?`, time.Now().UnixMilli(), conversationID, agentID)
	if err != nil {
		return ConversationBinding{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return ConversationBinding{}, err
	}
	if changed == 0 {
		return ConversationBinding{}, sql.ErrNoRows
	}
	bindings, err := s.ListBindings(ctx, conversationID)
	if err != nil {
		return ConversationBinding{}, err
	}
	for _, binding := range bindings {
		if binding.AgentID == agentID {
			return binding, nil
		}
	}
	return ConversationBinding{}, sql.ErrNoRows
}

func (s *Store) UpsertBinding(ctx context.Context, binding ConversationBinding) error {
	if binding.ConversationID == "" || binding.AgentID == "" || binding.RuntimeID == "" || binding.NativeSessionID == "" {
		return errors.New("conversation, agent, runtime and native session are required")
	}
	if binding.Generation <= 0 {
		binding.Generation = 1
	}
	if binding.State == "" {
		binding.State = "ready"
	}
	if binding.LastActiveAt == 0 {
		binding.LastActiveAt = time.Now().UnixMilli()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO conversation_agent_bindings
		(conversation_id,agent_id,runtime_id,native_session_id,generation,state,effective_provider,effective_model,effective_thinking_level,effective_cwd,last_active_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id,agent_id) DO UPDATE SET
		runtime_id=excluded.runtime_id,native_session_id=excluded.native_session_id,state=excluded.state,
		effective_provider=excluded.effective_provider,effective_model=excluded.effective_model,
		effective_thinking_level=excluded.effective_thinking_level,effective_cwd=excluded.effective_cwd,last_active_at=excluded.last_active_at`,
		binding.ConversationID, binding.AgentID, binding.RuntimeID, binding.NativeSessionID, binding.Generation,
		binding.State, binding.EffectiveProvider, binding.EffectiveModel, binding.EffectiveThinking, binding.EffectiveCwd, binding.LastActiveAt)
	return err
}

func (s *Store) ListBindings(ctx context.Context, conversationID string) ([]ConversationBinding, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT conversation_id,agent_id,runtime_id,native_session_id,generation,state,
		effective_provider,effective_model,effective_thinking_level,effective_cwd,last_active_at
		FROM conversation_agent_bindings WHERE conversation_id=? ORDER BY agent_id`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ConversationBinding{}
	for rows.Next() {
		var binding ConversationBinding
		if err := rows.Scan(&binding.ConversationID, &binding.AgentID, &binding.RuntimeID, &binding.NativeSessionID,
			&binding.Generation, &binding.State, &binding.EffectiveProvider, &binding.EffectiveModel,
			&binding.EffectiveThinking, &binding.EffectiveCwd, &binding.LastActiveAt); err != nil {
			return nil, err
		}
		result = append(result, binding)
	}
	return result, rows.Err()
}

func (s *Store) TouchRuntime(ctx context.Context, runtimeID, instanceID string) error {
	now := time.Now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_nodes SET status='online',last_seen_at=? WHERE id=? AND instance_id=?`, now, runtimeID, instanceID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET status='ready',updated_at=? WHERE runtime_id=?`, now, runtimeID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) MarkStaleRuntimes(ctx context.Context, cutoff int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM runtime_nodes WHERE status='online' AND last_seen_at<?`, cutoff)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return ids, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_nodes SET status='stale' WHERE id=? AND status='online'`, id); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE agents SET status='offline',updated_at=? WHERE runtime_id=?`, time.Now().UnixMilli(), id); err != nil {
			return nil, err
		}
	}
	return ids, tx.Commit()
}

func (s *Store) UpsertRuntimeNode(ctx context.Context, registration runtimeRegistration) error {
	capabilities, err := json.Marshal(registration.Capabilities)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO runtime_nodes
		(id,name,status,instance_id,version,node_version,pi_version,os,architecture,capabilities_json,last_seen_at,config_version)
		VALUES(?,?,'online',?,?,?,?,?,?,?,?,1)
		ON CONFLICT(id) DO UPDATE SET status='online',instance_id=excluded.instance_id,
		version=excluded.version,node_version=excluded.node_version,pi_version=excluded.pi_version,os=excluded.os,
		architecture=excluded.architecture,capabilities_json=excluded.capabilities_json,last_seen_at=excluded.last_seen_at`,
		registration.RuntimeID, registration.Name, registration.InstanceID, registration.Version,
		registration.NodeVersion, registration.PiVersion, registration.OS, registration.Architecture,
		capabilities, time.Now().UnixMilli())
	return err
}

func (s *Store) ListRuntimeNodes(ctx context.Context) ([]RuntimeNode, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,status,control_state,instance_id,version,node_version,pi_version,os,architecture,
		capabilities_json,last_seen_at,config_version FROM runtime_nodes ORDER BY name,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []RuntimeNode{}
	for rows.Next() {
		var node RuntimeNode
		var capabilities []byte
		if err := rows.Scan(&node.ID, &node.Name, &node.Status, &node.ControlState, &node.InstanceID, &node.Version,
			&node.NodeVersion, &node.PiVersion, &node.OS, &node.Architecture, &capabilities,
			&node.LastSeenAt, &node.ConfigVersion); err != nil {
			return nil, err
		}
		node.Capabilities = append(json.RawMessage(nil), capabilities...)
		result = append(result, node)
	}
	return result, rows.Err()
}

func scanRuntimeNode(scanner interface{ Scan(...any) error }) (RuntimeNode, error) {
	var node RuntimeNode
	var capabilities []byte
	err := scanner.Scan(&node.ID, &node.Name, &node.Status, &node.ControlState, &node.InstanceID, &node.Version,
		&node.NodeVersion, &node.PiVersion, &node.OS, &node.Architecture, &capabilities, &node.LastSeenAt, &node.ConfigVersion)
	node.Capabilities = append(json.RawMessage(nil), capabilities...)
	return node, err
}

const runtimeNodeSelect = `SELECT id,name,status,control_state,instance_id,version,node_version,pi_version,os,architecture,capabilities_json,last_seen_at,config_version FROM runtime_nodes`

func (s *Store) GetRuntimeNode(ctx context.Context, id string) (RuntimeNode, error) {
	return scanRuntimeNode(s.db.QueryRowContext(ctx, runtimeNodeSelect+` WHERE id=?`, strings.TrimSpace(id)))
}

func (s *Store) SetRuntimeControlState(ctx context.Context, id, state string) (RuntimeNode, error) {
	state = strings.TrimSpace(state)
	if state != "active" && state != "draining" && state != "disabled" {
		return RuntimeNode{}, errors.New("invalid runtime control state")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE runtime_nodes SET control_state=?,config_version=config_version+1 WHERE id=?`, state, strings.TrimSpace(id))
	if err != nil {
		return RuntimeNode{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return RuntimeNode{}, err
	}
	if changed == 0 {
		return RuntimeNode{}, sql.ErrNoRows
	}
	return s.GetRuntimeNode(ctx, id)
}

func (s *Store) RenameRuntimeNode(ctx context.Context, id, name string) (RuntimeNode, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return RuntimeNode{}, errors.New("runtime name is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RuntimeNode{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE runtime_nodes SET name=?,config_version=config_version+1 WHERE id=?`, name, strings.TrimSpace(id))
	if err != nil {
		return RuntimeNode{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return RuntimeNode{}, err
	}
	if changed == 0 {
		return RuntimeNode{}, sql.ErrNoRows
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET runtime_name=? WHERE runtime_id=?`, name, strings.TrimSpace(id)); err != nil {
		return RuntimeNode{}, err
	}
	if err := tx.Commit(); err != nil {
		return RuntimeNode{}, err
	}
	return s.GetRuntimeNode(ctx, id)
}

func (s *Store) UpdateAgentConfig(ctx context.Context, agentID string, patch AgentConfigPatch) (AgentInfo, error) {
	agentID = strings.TrimSpace(agentID)
	patch.Name = strings.TrimSpace(patch.Name)
	patch.Handle = strings.TrimSpace(patch.Handle)
	patch.DesiredProvider = strings.TrimSpace(patch.DesiredProvider)
	patch.DesiredModel = strings.TrimSpace(patch.DesiredModel)
	patch.DesiredThinking = strings.TrimSpace(patch.DesiredThinking)
	patch.DesiredCwd = strings.TrimSpace(patch.DesiredCwd)
	if agentID == "" || patch.Name == "" {
		return AgentInfo{}, errors.New("agent id and name are required")
	}
	if patch.DesiredThinking != "" {
		valid := map[string]bool{"off": true, "minimal": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}
		if !valid[patch.DesiredThinking] {
			return AgentInfo{}, errors.New("invalid thinking level")
		}
	}
	result, err := s.db.ExecContext(ctx, `UPDATE agents SET name=?,handle=?,description=?,instructions=?,
		desired_provider=?,desired_model=?,desired_thinking_level=?,desired_cwd=?,config_version=config_version+1,updated_at=?
		WHERE id=? AND archived_at IS NULL`, patch.Name, patch.Handle, patch.Description, patch.Instructions,
		patch.DesiredProvider, patch.DesiredModel, patch.DesiredThinking, patch.DesiredCwd, time.Now().UnixMilli(), agentID)
	if err != nil {
		return AgentInfo{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return AgentInfo{}, err
	}
	if changed == 0 {
		return AgentInfo{}, sql.ErrNoRows
	}
	agents, err := s.ListAgents(ctx)
	if err != nil {
		return AgentInfo{}, err
	}
	for _, agent := range agents {
		if agent.ID == agentID {
			return agent, nil
		}
	}
	return AgentInfo{}, sql.ErrNoRows
}

func (s *Store) UpsertRuntimeAgents(ctx context.Context, runtimeID, runtimeName string, agents []AgentInfo) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	if _, err = tx.ExecContext(ctx, `UPDATE agents SET status='offline',updated_at=? WHERE runtime_id=?`, now, runtimeID); err != nil {
		return err
	}
	for _, agent := range agents {
		_, err = tx.ExecContext(ctx, `INSERT INTO agents(id,name,provider,runtime_id,runtime_name,cwd,status,updated_at,
			desired_provider,desired_model,desired_thinking_level,desired_cwd)
			VALUES(?,?,?,?,?,?,'ready',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,
			runtime_id=excluded.runtime_id,runtime_name=excluded.runtime_name,cwd=excluded.cwd,status='ready',updated_at=excluded.updated_at,
			desired_provider=CASE WHEN agents.desired_provider='' THEN excluded.desired_provider ELSE agents.desired_provider END,
			desired_model=CASE WHEN agents.desired_model='' THEN excluded.desired_model ELSE agents.desired_model END,
			desired_thinking_level=CASE WHEN agents.desired_thinking_level='' THEN excluded.desired_thinking_level ELSE agents.desired_thinking_level END,
			desired_cwd=CASE WHEN agents.desired_cwd='' THEN excluded.desired_cwd ELSE agents.desired_cwd END`,
			agent.ID, agent.Name, agent.Provider, runtimeID, runtimeName, agent.Cwd, now,
			agent.DesiredProvider, agent.DesiredModel, agent.DesiredThinking, agent.DesiredCwd)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) SetRuntimeOffline(ctx context.Context, runtimeID string) error {
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx, `UPDATE runtime_nodes SET status=CASE WHEN status='stale' THEN 'stale' ELSE 'offline' END,last_seen_at=? WHERE id=?`, now, runtimeID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE agents SET status='offline',updated_at=? WHERE runtime_id=?`, now, runtimeID)
	return err
}

func (s *Store) ReconcileRuntimeRuns(ctx context.Context, runtimeID string, activeRuns []activeRunInfo) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, `UPDATE runs SET status='failed', error='runtime reconnected without this active run'
		WHERE status='running' AND agent_id IN (SELECT id FROM agents WHERE runtime_id=?)`, runtimeID); err != nil {
		return err
	}
	for _, active := range activeRuns {
		if active.RunID == "" || active.AgentID == "" {
			continue
		}
		if _, err = tx.ExecContext(ctx, `UPDATE runs SET status='running', error=''
			WHERE id=? AND agent_id=? AND agent_id IN (SELECT id FROM agents WHERE runtime_id=?)`,
			active.RunID, active.AgentID, runtimeID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) PopulateAgentPresence(ctx context.Context, agents []AgentInfo) error {
	for index := range agents {
		if !agents[index].Online {
			agents[index].Presence = "offline"
		} else {
			agents[index].Presence = "available"
		}
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM employee_inbox WHERE recipient_agent_id=? AND state='queued'`, agents[index].ID).Scan(&agents[index].InboxUnread); err != nil {
			return err
		}
		var active int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs WHERE agent_id=? AND status='running'`, agents[index].ID).Scan(&active); err != nil {
			return err
		}
		if active > 0 {
			agents[index].Presence = "working"
		} else if agents[index].InboxUnread > 0 {
			agents[index].Presence = "waiting"
		}
	}
	return nil
}

func (s *Store) ListAgents(ctx context.Context) ([]AgentInfo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,runtime_id,runtime_name,provider,cwd,status='ready',
		handle,description,instructions,desired_provider,desired_model,desired_thinking_level,desired_cwd,config_version
		FROM agents WHERE archived_at IS NULL ORDER BY name,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	agents := []AgentInfo{}
	for rows.Next() {
		var agent AgentInfo
		if err := rows.Scan(&agent.ID, &agent.Name, &agent.RuntimeID, &agent.Runtime, &agent.Provider, &agent.Cwd, &agent.Online,
			&agent.Handle, &agent.Description, &agent.Instructions, &agent.DesiredProvider, &agent.DesiredModel,
			&agent.DesiredThinking, &agent.DesiredCwd, &agent.ConfigVersion); err != nil {
			return nil, err
		}
		agents = append(agents, agent)
	}
	return agents, rows.Err()
}

func (s *Store) seedDefaultChannels(ctx context.Context) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM channels`).Scan(&count); err != nil || count != 0 {
		return err
	}
	defaults := []Channel{
		{ID: "channel-host-pi", Title: "Host Pi 对话", AgentIDs: []string{"host-pi"}, CreatedAt: 1},
		{ID: "channel-runtime-design", Title: "Runtime 架构设计", AgentIDs: []string{"host-pi", "docker-pi"}, CreatedAt: 2},
	}
	for _, channel := range defaults {
		if err := s.CreateChannel(ctx, channel); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) CreateWorkspace(ctx context.Context, workspace Workspace) error {
	workspace.ID = strings.TrimSpace(workspace.ID)
	workspace.Name = strings.TrimSpace(workspace.Name)
	workspace.Cwd = strings.TrimSpace(workspace.Cwd)
	if workspace.ID == "" || workspace.Name == "" {
		return errors.New("workspace id and name are required")
	}
	if workspace.CreatedAt == 0 {
		workspace.CreatedAt = time.Now().UnixMilli()
	}
	if workspace.UpdatedAt == 0 {
		workspace.UpdatedAt = workspace.CreatedAt
	}
	var duplicate int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL AND lower(name)=lower(?)`, workspace.Name).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate > 0 {
		return errors.New("workspace name already exists")
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO workspaces(id,name,cwd,created_at,updated_at) VALUES(?,?,?,?,?)`, workspace.ID, workspace.Name, workspace.Cwd, workspace.CreatedAt, workspace.UpdatedAt)
	return err
}

func (s *Store) ListWorkspaces(ctx context.Context) ([]Workspace, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,cwd,created_at,updated_at FROM workspaces WHERE deleted_at IS NULL ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, created_at, id`, defaultWorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Workspace{}
	for rows.Next() {
		var workspace Workspace
		if err := rows.Scan(&workspace.ID, &workspace.Name, &workspace.Cwd, &workspace.CreatedAt, &workspace.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, workspace)
	}
	return result, rows.Err()
}

func (s *Store) GetWorkspace(ctx context.Context, id string) (Workspace, error) {
	var workspace Workspace
	err := s.db.QueryRowContext(ctx, `SELECT id,name,cwd,created_at,updated_at FROM workspaces WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(id)).Scan(&workspace.ID, &workspace.Name, &workspace.Cwd, &workspace.CreatedAt, &workspace.UpdatedAt)
	return workspace, err
}

func (s *Store) WorkspaceCwdForConversation(ctx context.Context, conversationID string) (string, error) {
	var cwd string
	err := s.db.QueryRowContext(ctx, `SELECT w.cwd FROM workspaces w JOIN channels c ON c.workspace_id=w.id
		WHERE c.deleted_at IS NULL AND w.deleted_at IS NULL AND c.id=COALESCE(
			(SELECT channel_id FROM threads WHERE id=? AND deleted_at IS NULL), ?
		)`, conversationID, conversationID).Scan(&cwd)
	return cwd, err
}

func (s *Store) UpdateWorkspace(ctx context.Context, id, name, cwd string) (Workspace, error) {
	id, name, cwd = strings.TrimSpace(id), strings.TrimSpace(name), strings.TrimSpace(cwd)
	if id == "" || name == "" {
		return Workspace{}, errors.New("workspace id and name are required")
	}
	var duplicate int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspaces WHERE id<>? AND deleted_at IS NULL AND lower(name)=lower(?)`, id, name).Scan(&duplicate); err != nil {
		return Workspace{}, err
	}
	if duplicate > 0 {
		return Workspace{}, errors.New("workspace name already exists")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE workspaces SET name=?,cwd=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, name, cwd, time.Now().UnixMilli(), id)
	if err != nil {
		return Workspace{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Workspace{}, err
	}
	if changed == 0 {
		return Workspace{}, sql.ErrNoRows
	}
	return s.GetWorkspace(ctx, id)
}

func (s *Store) DeleteWorkspace(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == defaultWorkspaceID {
		return errors.New("default workspace cannot be deleted")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE workspaces SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL`, time.Now().UnixMilli(), time.Now().UnixMilli(), id)
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
	if _, err := tx.ExecContext(ctx, `UPDATE channels SET deleted_at=? WHERE workspace_id=? AND deleted_at IS NULL`, time.Now().UnixMilli(), id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CreateChannel(ctx context.Context, channel Channel) error {
	if channel.ID == "" || channel.Title == "" || len(channel.AgentIDs) == 0 {
		return errors.New("channel id, title and at least one agent are required")
	}
	if channel.CreatedAt == 0 {
		channel.CreatedAt = time.Now().UnixMilli()
	}
	if strings.TrimSpace(channel.WorkspaceID) == "" {
		channel.WorkspaceID = defaultWorkspaceID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	insertResult, err := tx.ExecContext(ctx, `INSERT INTO channels(id, title, workspace_id, created_at)
		SELECT ?,?,?,? FROM workspaces WHERE id=? AND deleted_at IS NULL`, channel.ID, channel.Title, channel.WorkspaceID, channel.CreatedAt, channel.WorkspaceID)
	if err != nil {
		return err
	}
	inserted, err := insertResult.RowsAffected()
	if err != nil {
		return err
	}
	if inserted == 0 {
		return errors.New("workspace not found")
	}
	seen := make(map[string]struct{}, len(channel.AgentIDs))
	for _, agentID := range channel.AgentIDs {
		if agentID == "" {
			return errors.New("agent id cannot be empty")
		}
		if _, exists := seen[agentID]; exists {
			continue
		}
		seen[agentID] = struct{}{}
		if _, err = tx.ExecContext(ctx, `INSERT INTO channel_agents(channel_id, agent_id, created_at) VALUES (?, ?, ?)`, channel.ID, agentID, channel.CreatedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListChannels(ctx context.Context) ([]Channel, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.title, c.workspace_id, c.created_at, ca.agent_id
		FROM channels c JOIN channel_agents ca ON ca.channel_id = c.id
		WHERE c.deleted_at IS NULL
		ORDER BY c.created_at DESC, c.id, ca.rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Channel
	positions := map[string]int{}
	for rows.Next() {
		var id, title, workspaceID, agentID string
		var createdAt int64
		if err := rows.Scan(&id, &title, &workspaceID, &createdAt, &agentID); err != nil {
			return nil, err
		}
		position, exists := positions[id]
		if !exists {
			position = len(result)
			positions[id] = position
			result = append(result, Channel{ID: id, Title: title, WorkspaceID: workspaceID, CreatedAt: createdAt, AgentIDs: []string{}})
		}
		result[position].AgentIDs = append(result[position].AgentIDs, agentID)
	}
	return result, rows.Err()
}

func (s *Store) CreateThread(ctx context.Context, thread Thread) error {
	thread.ID = strings.TrimSpace(thread.ID)
	thread.ChannelID = strings.TrimSpace(thread.ChannelID)
	thread.Title = strings.TrimSpace(thread.Title)
	if thread.ID == "" || thread.ChannelID == "" || thread.Title == "" {
		return errors.New("thread id, channel id and title are required")
	}
	if thread.CreatedAt == 0 {
		thread.CreatedAt = time.Now().UnixMilli()
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO threads(id,channel_id,root_turn_id,title,created_at)
		SELECT ?,c.id,NULLIF(?,''),?,? FROM channels c
		WHERE c.id=? AND c.deleted_at IS NULL
		AND (?='' OR EXISTS (
			SELECT 1 FROM turns tr WHERE tr.id=? AND tr.channel_id=c.id
			AND COALESCE(tr.conversation_id,tr.channel_id)=c.id
		))`,
		thread.ID, thread.RootTurnID, thread.Title, thread.CreatedAt, thread.ChannelID,
		thread.RootTurnID, thread.RootTurnID)
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

func (s *Store) ListThreads(ctx context.Context, channelID string) ([]Thread, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT th.id,th.channel_id,COALESCE(th.root_turn_id,''),COALESCE(root.message,''),th.title,th.created_at
		FROM threads th LEFT JOIN turns root ON root.id=th.root_turn_id
		WHERE th.channel_id=? AND th.deleted_at IS NULL ORDER BY th.created_at,th.id`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Thread{}
	for rows.Next() {
		var thread Thread
		if err := rows.Scan(&thread.ID, &thread.ChannelID, &thread.RootTurnID, &thread.RootText, &thread.Title, &thread.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, thread)
	}
	return result, rows.Err()
}

func (s *Store) DeleteThread(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE threads SET deleted_at=? WHERE id=? AND deleted_at IS NULL`, time.Now().UnixMilli(), id)
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

func (s *Store) RenameChannel(ctx context.Context, id, title string) error {
	id = strings.TrimSpace(id)
	title = strings.TrimSpace(title)
	if id == "" || title == "" {
		return errors.New("channel id and title are required")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE channels SET title=? WHERE id=? AND deleted_at IS NULL`, title, id)
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

func (s *Store) DeleteChannel(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE channels SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, time.Now().UnixMilli(), id)
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

func (s *Store) PromptForConversation(ctx context.Context, conversationID, turnID, message string) (string, error) {
	var rootMessage string
	err := s.db.QueryRowContext(ctx, `SELECT root.message
		FROM threads th
		JOIN turns root ON root.id=th.root_turn_id
		WHERE th.id=? AND th.deleted_at IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM turns existing
			WHERE existing.conversation_id=th.id AND existing.id<>?
		)`, conversationID, turnID).Scan(&rootMessage)
	if errors.Is(err, sql.ErrNoRows) {
		return message, nil
	}
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("[Thread root context]\n%s\n\n[Current message]\n%s", rootMessage, message), nil
}

func (s *Store) ListEmployeeInbox(ctx context.Context, agentID string) ([]EmployeeInbox, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,recipient_agent_id,source_message_id,state,reason,created_at,COALESCE(consumed_at,0)
		FROM employee_inbox WHERE recipient_agent_id=? ORDER BY created_at,rowid`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []EmployeeInbox{}
	for rows.Next() {
		var item EmployeeInbox
		if err := rows.Scan(&item.ID, &item.RecipientAgentID, &item.SourceMessageID, &item.State, &item.Reason, &item.CreatedAt, &item.ConsumedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ClaimMentionRuns(ctx context.Context, sourceMessageID string, maxAutoHops int) ([]SequentialRun, error) {
	return s.claimInboxRuns(ctx, sourceMessageID, "", maxAutoHops)
}

func (s *Store) ClaimPendingEmployeeRuns(ctx context.Context, agentID string, maxAutoHops int) ([]SequentialRun, error) {
	return s.claimInboxRuns(ctx, "", agentID, maxAutoHops)
}

func (s *Store) claimInboxRuns(ctx context.Context, sourceMessageID, recipientAgentID string, maxAutoHops int) ([]SequentialRun, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT i.id,i.recipient_agent_id,m.conversation_id,m.turn_id,m.author_id,m.content_json,i.source_message_id,m.version
		FROM employee_inbox i JOIN conversation_messages m ON m.id=i.source_message_id
		WHERE i.state='queued' AND (?='' OR i.source_message_id=?) AND (?='' OR i.recipient_agent_id=?)
		ORDER BY i.created_at,i.id`, sourceMessageID, sourceMessageID, recipientAgentID, recipientAgentID)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		inboxID, recipient, conversationID, turnID, authorID, sourceMessageID string
		content                                                               []byte
		version                                                               int64
	}
	candidates := []candidate{}
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.inboxID, &item.recipient, &item.conversationID, &item.turnID, &item.authorID, &item.content, &item.sourceMessageID, &item.version); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	result := []SequentialRun{}
	for _, item := range candidates {
		var autoHops, busy int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs WHERE turn_id=? AND trigger_message_id IS NOT NULL`, item.turnID).Scan(&autoHops); err != nil {
			return nil, err
		}
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs r JOIN turns t ON t.id=r.turn_id
			WHERE COALESCE(t.conversation_id,t.channel_id)=? AND r.agent_id=? AND r.status IN ('queued','running')`,
			item.conversationID, item.recipient).Scan(&busy); err != nil {
			return nil, err
		}
		if autoHops >= maxAutoHops {
			if _, err := tx.ExecContext(ctx, `UPDATE employee_inbox SET state='suppressed',reason='auto-hop limit reached',consumed_at=? WHERE id=?`,
				time.Now().UnixMilli(), item.inboxID); err != nil {
				return nil, err
			}
			continue
		}
		if busy > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE employee_inbox SET reason='waiting for employee to become available' WHERE id=?`, item.inboxID); err != nil {
				return nil, err
			}
			continue
		}
		runID := newID("run")
		var order int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(dispatch_order),-1)+1 FROM runs WHERE turn_id=?`, item.turnID).Scan(&order); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO runs(id,turn_id,agent_id,status,dispatch_order,trigger_message_id,created_at)
			VALUES(?,?,?,'running',?,?,?)`, runID, item.turnID, item.recipient, order, item.sourceMessageID, time.Now().UnixMilli()); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE employee_inbox SET state='consumed',reason='',consumed_at=? WHERE id=?`, time.Now().UnixMilli(), item.inboxID); err != nil {
			return nil, err
		}
		increment, seenThrough, err := conversationIncrementTx(ctx, tx, item.conversationID, item.recipient, item.version)
		if err != nil {
			return nil, err
		}
		if increment == "" {
			increment = "[Digital employee source message]\n@" + item.authorID + ":\n" + publicMessageText(item.content)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO participant_read_cursors
			(conversation_id,participant_type,participant_id,last_seen_version,updated_at) VALUES(?,'agent',?,?,?)
			ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET
			last_seen_version=MAX(participant_read_cursors.last_seen_version,excluded.last_seen_version),updated_at=excluded.updated_at`,
			item.conversationID, item.recipient, seenThrough, time.Now().UnixMilli()); err != nil {
			return nil, err
		}
		text := increment
		result = append(result, SequentialRun{
			ConversationID: item.conversationID, TurnID: item.turnID, RunID: runID, AgentID: item.recipient,
			Message: text +
				"\n\n[Current trigger]\n@" + item.authorID + " mentioned you in " + item.sourceMessageID + "." +
				"\n\nReply naturally in the Conversation. You may @mention another digital employee when their input is needed. Do not ask the user to copy messages between employees.",
		})
	}
	return result, tx.Commit()
}

func (s *Store) ConfigureSequentialTurn(ctx context.Context, turnID string, agentIDs []string, runIDs map[string]string) error {
	if len(agentIDs) < 2 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE turns SET execution_mode='sequential' WHERE id=?`, turnID); err != nil {
		return err
	}
	for order, agentID := range agentIDs {
		status := "queued"
		if order == 0 {
			status = "running"
		}
		result, err := tx.ExecContext(ctx, `UPDATE runs SET dispatch_order=?,status=? WHERE id=? AND turn_id=? AND agent_id=?`,
			order, status, runIDs[agentID], turnID, agentID)
		if err != nil {
			return err
		}
		if changed, _ := result.RowsAffected(); changed != 1 {
			return errors.New("sequential run mapping is incomplete")
		}
	}
	return tx.Commit()
}

func (s *Store) StartNextSequentialRun(ctx context.Context, completedRunID string) (SequentialRun, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SequentialRun{}, false, err
	}
	defer tx.Rollback()
	var turnID, conversationID, message, mode string
	var completedOrder int
	err = tx.QueryRowContext(ctx, `SELECT t.id,COALESCE(t.conversation_id,t.channel_id),t.message,t.execution_mode,r.dispatch_order
		FROM runs r JOIN turns t ON t.id=r.turn_id WHERE r.id=?`, completedRunID).
		Scan(&turnID, &conversationID, &message, &mode, &completedOrder)
	if errors.Is(err, sql.ErrNoRows) {
		return SequentialRun{}, false, nil
	}
	if err != nil {
		return SequentialRun{}, false, err
	}
	if mode != "sequential" {
		return SequentialRun{}, false, nil
	}
	var next SequentialRun
	next.TurnID, next.ConversationID, next.Message = turnID, conversationID, message
	err = tx.QueryRowContext(ctx, `SELECT id,agent_id FROM runs WHERE turn_id=? AND status='queued' AND dispatch_order>?
		ORDER BY dispatch_order LIMIT 1`, turnID, completedOrder).Scan(&next.RunID, &next.AgentID)
	if errors.Is(err, sql.ErrNoRows) {
		return SequentialRun{}, false, nil
	}
	if err != nil {
		return SequentialRun{}, false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT author_id,content_json FROM conversation_messages
		WHERE turn_id=? AND author_type='agent' ORDER BY created_at,id`, turnID)
	if err != nil {
		return SequentialRun{}, false, err
	}
	results := []string{}
	for rows.Next() {
		var author string
		var content []byte
		if err := rows.Scan(&author, &content); err != nil {
			rows.Close()
			return SequentialRun{}, false, err
		}
		text := publicMessageText(content)
		if text != "" {
			results = append(results, "@"+author+":\n"+text)
		}
	}
	if err := rows.Close(); err != nil {
		return SequentialRun{}, false, err
	}
	next.Message = "[Shared Conversation request]\n" + message
	if len(results) > 0 {
		next.Message += "\n\n[Completed Agent results]\n" + strings.Join(results, "\n\n")
	}
	next.Message += "\n\n[Your step]\nContinue the requested collaboration using the completed results above. Do not ask the user to copy another Agent's output."
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='running' WHERE id=? AND status='queued'`, next.RunID); err != nil {
		return SequentialRun{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE employee_inbox SET state='consumed',reason='delivered by sequential shared context',consumed_at=?
		WHERE recipient_agent_id=? AND state='queued' AND source_message_id IN (
			SELECT id FROM conversation_messages WHERE turn_id=?
		)`, time.Now().UnixMilli(), next.AgentID, turnID); err != nil {
		return SequentialRun{}, false, err
	}
	return next, true, tx.Commit()
}

func (s *Store) CreateTurn(ctx context.Context, conversationID, turnID, message string, createdAt int64, runIDs map[string]string) error {
	return s.CreateTurnWithMeta(ctx, conversationID, turnID, message, createdAt, runIDs, TurnMessageMeta{
		AuthorType: "member",
		AuthorID:   "local-user",
	})
}

func (s *Store) CreateTurnWithMeta(ctx context.Context, conversationID, turnID, message string, createdAt int64, runIDs map[string]string, meta TurnMessageMeta) error {
	conversationID = strings.TrimSpace(conversationID)
	turnID = strings.TrimSpace(turnID)
	message = strings.TrimSpace(message)
	meta.AuthorType = strings.TrimSpace(meta.AuthorType)
	meta.AuthorID = strings.TrimSpace(meta.AuthorID)
	meta.ReplyToTurnID = strings.TrimSpace(meta.ReplyToTurnID)
	meta.ReplyToMessageID = strings.TrimSpace(meta.ReplyToMessageID)
	if conversationID == "" || turnID == "" || message == "" || len(runIDs) == 0 {
		return errors.New("conversation, turn, message and runs are required")
	}
	if meta.AuthorType == "" {
		meta.AuthorType = "member"
	}
	if meta.AuthorID == "" {
		meta.AuthorID = "local-user"
	}
	if meta.AuthorType != "member" && meta.AuthorType != "agent" && meta.AuthorType != "system" {
		return errors.New("invalid author type")
	}
	if createdAt == 0 {
		createdAt = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if meta.ReplyToMessageID == "" && meta.ReplyToTurnID != "" {
		meta.ReplyToMessageID = "message-" + meta.ReplyToTurnID
	}
	if meta.ReplyToMessageID != "" {
		var targetTurnID string
		err = tx.QueryRowContext(ctx, `SELECT turn_id FROM conversation_messages WHERE id=? AND conversation_id=?`,
			meta.ReplyToMessageID, conversationID).Scan(&targetTurnID)
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("reply target must belong to the same conversation")
		}
		if err != nil {
			return err
		}
		meta.ReplyToTurnID = targetTurnID
	} else if meta.ReplyToTurnID != "" {
		var replyExists int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM turns
			WHERE id=? AND COALESCE(conversation_id,channel_id)=?`, meta.ReplyToTurnID, conversationID).Scan(&replyExists); err != nil {
			return err
		}
		if replyExists == 0 {
			return errors.New("reply target must belong to the same conversation")
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO turns(id, channel_id, conversation_id, author_type, author_id, reply_to_turn_id, reply_to_message_id, message, created_at)
		SELECT ?, c.id, ?, ?, ?, NULLIF(?,''), NULLIF(?,''), ?, ? FROM channels c WHERE c.id=? AND c.deleted_at IS NULL
		UNION ALL
		SELECT ?, t.channel_id, ?, ?, ?, NULLIF(?,''), NULLIF(?,''), ?, ? FROM threads t JOIN channels c ON c.id=t.channel_id
		WHERE t.id=? AND t.deleted_at IS NULL AND c.deleted_at IS NULL`,
		turnID, conversationID, meta.AuthorType, meta.AuthorID, meta.ReplyToTurnID, meta.ReplyToMessageID, message, createdAt, conversationID,
		turnID, conversationID, meta.AuthorType, meta.AuthorID, meta.ReplyToTurnID, meta.ReplyToMessageID, message, createdAt, conversationID); err != nil {
		return err
	}
	var exists int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM turns WHERE id = ?`, turnID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return sql.ErrNoRows
	}
	userContent, err := json.Marshal(map[string]any{
		"role": "user", "content": message, "timestamp": createdAt,
		"authorType": meta.AuthorType, "authorId": meta.AuthorID,
		"replyToTurnId": meta.ReplyToTurnID, "replyToMessageId": meta.ReplyToMessageID,
	})
	if err != nil {
		return err
	}
	version, err := nextConversationVersion(ctx, tx, conversationID)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_messages
		(id,conversation_id,turn_id,version,author_type,author_id,run_id,reply_to_message_id,content_json,created_at)
		VALUES(?,?,?,?,?, ?,NULL,NULLIF(?,''),?,?)`,
		"message-"+turnID, conversationID, turnID, version, meta.AuthorType, meta.AuthorID,
		meta.ReplyToMessageID, userContent, createdAt); err != nil {
		return err
	}
	if err := insertMessageMentions(ctx, tx, turnID, "message-"+turnID, message); err != nil {
		return err
	}
	for agentID, runID := range runIDs {
		if agentID == "" || runID == "" {
			return errors.New("agent and run ids are required")
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO runs(id, turn_id, agent_id, created_at) VALUES (?, ?, ?, ?)`, runID, turnID, agentID, createdAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func publicMessageText(message json.RawMessage) string {
	var decoded struct {
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(message, &decoded) != nil {
		return ""
	}
	var plain string
	if json.Unmarshal(decoded.Content, &plain) == nil {
		return strings.TrimSpace(plain)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(decoded.Content, &blocks) != nil {
		return ""
	}
	parts := []string{}
	for _, block := range blocks {
		if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, block.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func conversationIncrementTx(ctx context.Context, tx *sql.Tx, conversationID, participantID string, throughVersion int64) (string, int64, error) {
	var lastSeen int64
	err := tx.QueryRowContext(ctx, `SELECT last_seen_version FROM participant_read_cursors
		WHERE conversation_id=? AND participant_type='agent' AND participant_id=?`, conversationID, participantID).Scan(&lastSeen)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", 0, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT version,author_type,author_id,content_json FROM (
		SELECT version,author_type,author_id,content_json FROM conversation_messages
		WHERE conversation_id=? AND version>? AND version<=? ORDER BY version DESC LIMIT 50
	) ORDER BY version`, conversationID, lastSeen, throughVersion)
	if err != nil {
		return "", 0, err
	}
	defer rows.Close()
	const maxBytes = 64 << 10
	parts := []string{}
	firstVersion := int64(0)
	lastVersion := lastSeen
	total := 0
	for rows.Next() {
		var version int64
		var authorType, authorID string
		var content []byte
		if err := rows.Scan(&version, &authorType, &authorID, &content); err != nil {
			return "", 0, err
		}
		text := publicMessageText(content)
		if text == "" {
			continue
		}
		entry := fmt.Sprintf("[v%d %s @%s]\n%s", version, authorType, authorID, text)
		if total+len(entry) > maxBytes {
			parts = append(parts, "[increment truncated at 64 KiB]")
			break
		}
		if firstVersion == 0 {
			firstVersion = version
		}
		lastVersion = version
		total += len(entry)
		parts = append(parts, entry)
	}
	if err := rows.Err(); err != nil {
		return "", 0, err
	}
	if len(parts) == 0 {
		return "", lastSeen, nil
	}
	return fmt.Sprintf("[Authorized Conversation increment v%d..v%d]\n%s", firstVersion, lastVersion, strings.Join(parts, "\n\n")), lastVersion, nil
}

func mentionPresent(text, identity string) bool {
	text = strings.ToLower(text)
	needle := "@" + strings.ToLower(strings.TrimSpace(identity))
	if needle == "@" {
		return false
	}
	for offset := 0; offset < len(text); {
		index := strings.Index(text[offset:], needle)
		if index < 0 {
			return false
		}
		end := offset + index + len(needle)
		if end == len(text) || !strings.ContainsRune("abcdefghijklmnopqrstuvwxyz0123456789_-", rune(text[end])) {
			return true
		}
		offset = end
	}
	return false
}

func insertMessageMentions(ctx context.Context, tx *sql.Tx, turnID, messageID, text string) error {
	var authorType, authorID string
	if err := tx.QueryRowContext(ctx, `SELECT author_type,author_id FROM conversation_messages WHERE id=?`, messageID).Scan(&authorType, &authorID); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT a.id,a.name,a.handle FROM agents a
		JOIN channel_agents ca ON ca.agent_id=a.id JOIN turns t ON t.channel_id=ca.channel_id
		WHERE t.id=? AND a.archived_at IS NULL`, turnID)
	if err != nil {
		return err
	}
	type identity struct{ id, name, handle string }
	identities := []identity{}
	for rows.Next() {
		var value identity
		if err := rows.Scan(&value.id, &value.name, &value.handle); err != nil {
			rows.Close()
			return err
		}
		identities = append(identities, value)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, value := range identities {
		if !mentionPresent(text, value.id) && !mentionPresent(text, value.name) && !mentionPresent(text, value.handle) {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO message_mentions(message_id,agent_id,created_at) VALUES(?,?,?)`,
			messageID, value.id, time.Now().UnixMilli()); err != nil {
			return err
		}
		if authorType == "agent" && authorID != value.id {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO employee_inbox
				(id,recipient_agent_id,source_message_id,state,created_at) VALUES(?,?,?,'queued',?)`,
				"inbox-"+messageID+"-"+value.id, value.id, messageID, time.Now().UnixMilli()); err != nil {
				return err
			}
		}
	}
	return nil
}

func assistantHasPublicAnswer(message json.RawMessage) bool {
	var decoded struct {
		Role         string `json:"role"`
		StopReason   string `json:"stopReason"`
		ErrorMessage string `json:"errorMessage"`
		Content      []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(message, &decoded) != nil || decoded.Role != "assistant" || decoded.StopReason == "toolUse" {
		return false
	}
	if decoded.StopReason == "error" && strings.TrimSpace(decoded.ErrorMessage) != "" {
		return true
	}
	for _, block := range decoded.Content {
		if block.Type == "image" || (block.Type == "text" && strings.TrimSpace(block.Text) != "") {
			return true
		}
	}
	return false
}

func materializeAgentMessage(ctx context.Context, tx *sql.Tx, runID string) error {
	rows, err := tx.QueryContext(ctx, `SELECT payload_json FROM events WHERE run_id=? AND event_type='message_end' ORDER BY seq DESC`, runID)
	if err != nil {
		return err
	}
	var finalMessage json.RawMessage
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			rows.Close()
			return err
		}
		var envelope struct {
			Message json.RawMessage `json:"message"`
		}
		if json.Unmarshal(payload, &envelope) == nil && assistantHasPublicAnswer(envelope.Message) {
			finalMessage = append(json.RawMessage(nil), envelope.Message...)
			break
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(finalMessage) == 0 {
		return nil
	}
	var turnID, conversationID, agentID, replyToMessageID string
	if err := tx.QueryRowContext(ctx, `SELECT t.id,COALESCE(t.conversation_id,t.channel_id),r.agent_id,
		COALESCE(r.trigger_message_id,'message-'||t.id)
		FROM runs r JOIN turns t ON t.id=r.turn_id WHERE r.id=?`, runID).Scan(&turnID, &conversationID, &agentID, &replyToMessageID); err != nil {
		return err
	}
	var existing int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM conversation_messages WHERE run_id=?`, runID).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	version, err := nextConversationVersion(ctx, tx, conversationID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO conversation_messages
		(id,conversation_id,turn_id,version,author_type,author_id,run_id,reply_to_message_id,content_json,created_at)
		VALUES(?,?,?,?,'agent',?,?,?, ?,?)`, "message-"+runID, conversationID, turnID, version, agentID, runID,
		replyToMessageID, finalMessage, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	return insertMessageMentions(ctx, tx, turnID, "message-"+runID, publicMessageText(finalMessage))
}

func (s *Store) AppendRuntimeEvent(
	ctx context.Context,
	runtimeID, instanceID string,
	runtimeSeq uint64,
	event queuedEvent,
) (bool, error) {
	if runtimeID == "" || instanceID == "" || runtimeSeq == 0 || event.runID == "" || event.eventType == "" {
		return false, errors.New("runtime, instance, sequence, run and event type are required")
	}
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO runtime_event_receipts
		(runtime_id,instance_id,runtime_seq,run_id,event_type,created_at) VALUES(?,?,?,?,?,?)`,
		runtimeID, instanceID, runtimeSeq, event.runID, event.eventType, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if inserted == 0 {
		return false, tx.Commit()
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO events(run_id, seq, event_type, payload_json, error, created_at)
		SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ? FROM events WHERE run_id = ?`,
		event.runID, event.eventType, []byte(event.payload), event.eventError, time.Now().UnixMilli(), event.runID); err != nil {
		return false, err
	}
	if event.eventType == "agent_settled" {
		_, err = tx.ExecContext(ctx, `UPDATE runs SET status = 'settled', error = '' WHERE id = ?`, event.runID)
		if err == nil {
			err = materializeAgentMessage(ctx, tx, event.runID)
		}
	} else if event.eventType == "agent_error" || event.eventType == "host_error" {
		_, err = tx.ExecContext(ctx, `UPDATE runs SET status = 'failed', error = ? WHERE id = ?`, event.eventError, event.runID)
	}
	if err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (s *Store) AppendEvent(ctx context.Context, runID, eventType string, payload json.RawMessage, eventError string) error {
	if runID == "" || eventType == "" {
		return errors.New("run id and event type are required")
	}
	// Serialize sequence allocation for synchronous terminal events and the
	// asynchronous batch worker. The unique key remains the final guard.
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO events(run_id, seq, event_type, payload_json, error, created_at)
		SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ? FROM events WHERE run_id = ?`,
		runID, eventType, []byte(payload), eventError, time.Now().UnixMilli(), runID); err != nil {
		return err
	}
	if eventType == "agent_settled" {
		_, err = tx.ExecContext(ctx, `UPDATE runs SET status = 'settled', error = '' WHERE id = ?`, runID)
		if err == nil {
			err = materializeAgentMessage(ctx, tx, runID)
		}
	} else if eventType == "agent_error" || eventType == "host_error" {
		_, err = tx.ExecContext(ctx, `UPDATE runs SET status = 'failed', error = ? WHERE id = ?`, eventError, runID)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ConversationMessages(ctx context.Context, conversationID string) ([]PublicMessage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,conversation_id,turn_id,version,author_type,author_id,
		COALESCE(run_id,''),COALESCE(reply_to_message_id,''),content_json,created_at
		FROM conversation_messages WHERE conversation_id=? ORDER BY created_at,id`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []PublicMessage{}
	for rows.Next() {
		var message PublicMessage
		var content []byte
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.TurnID, &message.Version, &message.AuthorType,
			&message.AuthorID, &message.RunID, &message.ReplyToMessageID, &content, &message.CreatedAt); err != nil {
			return nil, err
		}
		message.Content = append(json.RawMessage(nil), content...)
		mentionRows, err := s.db.QueryContext(ctx, `SELECT agent_id FROM message_mentions WHERE message_id=? ORDER BY agent_id`, message.ID)
		if err != nil {
			return nil, err
		}
		message.Mentions = []string{}
		for mentionRows.Next() {
			var agentID string
			if err := mentionRows.Scan(&agentID); err != nil {
				mentionRows.Close()
				return nil, err
			}
			message.Mentions = append(message.Mentions, agentID)
		}
		if err := mentionRows.Close(); err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	return result, rows.Err()
}

func (s *Store) ConversationCursors(ctx context.Context, conversationID string) ([]RuntimeCursor, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT re.runtime_id,re.instance_id,MAX(re.runtime_seq)
		FROM runtime_event_receipts re
		JOIN runs r ON r.id=re.run_id
		JOIN turns t ON t.id=r.turn_id
		WHERE COALESCE(t.conversation_id,t.channel_id)=?
		GROUP BY re.runtime_id,re.instance_id`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []RuntimeCursor{}
	for rows.Next() {
		var cursor RuntimeCursor
		if err := rows.Scan(&cursor.RuntimeID, &cursor.InstanceID, &cursor.Sequence); err != nil {
			return nil, err
		}
		result = append(result, cursor)
	}
	return result, rows.Err()
}

func (s *Store) ConversationTurns(ctx context.Context, conversationID string) ([]StoredTurn, error) {
	turnRows, err := s.db.QueryContext(ctx, `SELECT t.id,t.message,t.created_at,t.author_type,t.author_id,
		COALESCE(t.reply_to_turn_id,''),COALESCE(reply.message,'')
		FROM turns t LEFT JOIN turns reply ON reply.id=t.reply_to_turn_id
		WHERE COALESCE(t.conversation_id,t.channel_id)=? ORDER BY t.created_at,t.id`, conversationID)
	if err != nil {
		return nil, err
	}
	defer turnRows.Close()
	turns := []StoredTurn{}
	for turnRows.Next() {
		var id, message, authorType, authorID, replyToTurnID, replyToText string
		var createdAt int64
		if err := turnRows.Scan(&id, &message, &createdAt, &authorType, &authorID, &replyToTurnID, &replyToText); err != nil {
			return nil, err
		}
		user := map[string]any{
			"role": "user", "content": message, "timestamp": createdAt,
			"authorType": authorType, "authorId": authorID,
		}
		if replyToTurnID != "" {
			user["replyToTurnId"] = replyToTurnID
			user["replyToText"] = replyToText
		}
		turns = append(turns, StoredTurn{
			ID:   id,
			User: user,
			Runs: []StoredRun{},
		})
	}
	if err := turnRows.Err(); err != nil {
		return nil, err
	}
	for turnIndex := range turns {
		runRows, err := s.db.QueryContext(ctx, `SELECT r.id,r.agent_id,r.status,r.error,COALESCE(m.id,'')
			FROM runs r LEFT JOIN conversation_messages m ON m.run_id=r.id
			WHERE r.turn_id=? ORDER BY r.created_at,r.id`, turns[turnIndex].ID)
		if err != nil {
			return nil, err
		}
		for runRows.Next() {
			var run StoredRun
			var status string
			if err := runRows.Scan(&run.ID, &run.AgentID, &status, &run.Error, &run.FinalMessageID); err != nil {
				runRows.Close()
				return nil, err
			}
			run.Status = status
			run.Settled = status != "running" && status != "queued"
			run.Messages = []json.RawMessage{}
			eventRows, err := s.db.QueryContext(ctx, `SELECT payload_json FROM events WHERE run_id = ? AND event_type = 'message_end' ORDER BY seq`, run.ID)
			if err != nil {
				runRows.Close()
				return nil, err
			}
			for eventRows.Next() {
				var payload []byte
				if err := eventRows.Scan(&payload); err != nil {
					eventRows.Close()
					runRows.Close()
					return nil, err
				}
				var envelope struct {
					Message json.RawMessage `json:"message"`
				}
				if json.Unmarshal(payload, &envelope) == nil && len(envelope.Message) > 0 && string(envelope.Message) != "null" {
					run.Messages = append(run.Messages, envelope.Message)
				}
			}
			eventRows.Close()
			turns[turnIndex].Runs = append(turns[turnIndex].Runs, run)
		}
		runRows.Close()
	}
	return turns, nil
}

type queuedEvent struct {
	runID, eventType, eventError string
	payload                      json.RawMessage
}

type EventWriter struct {
	store *Store
	queue chan queuedEvent
}

func NewEventWriter(store *Store, capacity int) *EventWriter {
	writer := &EventWriter{store: store, queue: make(chan queuedEvent, capacity)}
	go writer.loop()
	return writer
}

func (w *EventWriter) Enqueue(event queuedEvent) bool {
	select {
	case w.queue <- event:
		return true
	default:
		return false
	}
}

func (w *EventWriter) loop() {
	for event := range w.queue {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := w.store.AppendEvent(ctx, event.runID, event.eventType, event.payload, event.eventError)
		cancel()
		if err != nil {
			// A transient stream event may be omitted; terminal events use the
			// synchronous path and never enter this best-effort queue.
			fmt.Fprintf(os.Stderr, "persist event run=%s type=%s: %v\n", event.runID, event.eventType, err)
		}
	}
}
