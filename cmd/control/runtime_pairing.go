package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

type RuntimePairing struct {
	ID        string `json:"id"`
	Token     string `json:"token,omitempty"`
	ExpiresAt int64  `json:"expiresAt"`
	CreatedAt int64  `json:"createdAt"`
}

type RuntimeCredential struct {
	ID        string `json:"id"`
	RuntimeID string `json:"runtimeId"`
	Secret    string `json:"secret,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

func randomSecret(prefix string) (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(value), nil
}

func secretHash(value string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(digest[:])
}

func (s *Store) CreateRuntimePairing(ctx context.Context, ttl time.Duration) (RuntimePairing, error) {
	if ttl <= 0 || ttl > time.Hour {
		ttl = 15 * time.Minute
	}
	token, err := randomSecret("pair_")
	if err != nil {
		return RuntimePairing{}, err
	}
	id := newID("pairing")
	now := time.Now().UnixMilli()
	item := RuntimePairing{ID: id, Token: token, ExpiresAt: time.Now().Add(ttl).UnixMilli(), CreatedAt: now}
	_, err = s.db.ExecContext(ctx, `INSERT INTO runtime_pairing_tokens(id,token_hash,expires_at,created_at) VALUES(?,?,?,?)`, item.ID, secretHash(token), item.ExpiresAt, item.CreatedAt)
	return item, err
}

func (s *Store) ExchangeRuntimePairing(ctx context.Context, token, runtimeID string) (RuntimeCredential, error) {
	token, runtimeID = strings.TrimSpace(token), strings.TrimSpace(runtimeID)
	if token == "" || runtimeID == "" {
		return RuntimeCredential{}, errors.New("pairing token and runtime id are required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RuntimeCredential{}, err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	var pairingID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM runtime_pairing_tokens WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?`, secretHash(token), now).Scan(&pairingID)
	if errors.Is(err, sql.ErrNoRows) {
		return RuntimeCredential{}, errors.New("pairing token is invalid, expired, or already used")
	}
	if err != nil {
		return RuntimeCredential{}, err
	}
	secret, err := randomSecret("runtime_")
	if err != nil {
		return RuntimeCredential{}, err
	}
	credential := RuntimeCredential{ID: newID("credential"), RuntimeID: runtimeID, Secret: secret, CreatedAt: now}
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_pairing_tokens SET used_at=? WHERE id=? AND used_at IS NULL`, now, pairingID); err != nil {
		return RuntimeCredential{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_credentials(id,runtime_id,credential_hash,created_at) VALUES(?,?,?,?)`, credential.ID, runtimeID, secretHash(secret), now); err != nil {
		return RuntimeCredential{}, err
	}
	if err := tx.Commit(); err != nil {
		return RuntimeCredential{}, err
	}
	return credential, nil
}

func (s *Store) VerifyRuntimeCredential(ctx context.Context, secret string) (string, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", errors.New("runtime credential is required")
	}
	var runtimeID string
	err := s.db.QueryRowContext(ctx, `SELECT runtime_id FROM runtime_credentials WHERE credential_hash=? AND revoked_at IS NULL`, secretHash(secret)).Scan(&runtimeID)
	if err != nil {
		return "", err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE runtime_credentials SET last_used_at=? WHERE credential_hash=?`, time.Now().UnixMilli(), secretHash(secret))
	return runtimeID, nil
}

func (s *Store) RevokeRuntimeCredentials(ctx context.Context, runtimeID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE runtime_credentials SET revoked_at=? WHERE runtime_id=? AND revoked_at IS NULL`, time.Now().UnixMilli(), strings.TrimSpace(runtimeID))
	return err
}
