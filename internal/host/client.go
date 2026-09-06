package host

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

type Envelope struct {
	Type       string          `json:"type"`
	ID         string          `json:"id,omitempty"`
	SessionKey string          `json:"sessionKey,omitempty"`
	RunID      string          `json:"runId,omitempty"`
	Success    bool            `json:"success,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
	Error      string          `json:"error,omitempty"`
	Event      json.RawMessage `json:"event,omitempty"`
}

type request struct {
	ID     string         `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

type Client struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	writeMu sync.Mutex

	pendingMu sync.Mutex
	pending   map[string]chan Envelope

	subsMu sync.RWMutex
	subs   map[uint64]func(Envelope)
	nextID atomic.Uint64

	done chan struct{}
	err  atomic.Pointer[error]
}

func Start(ctx context.Context, node, script, dataDir string) (*Client, error) {
	cmd := exec.CommandContext(ctx, node, script)
	cmd.Env = append(os.Environ(), "MULTI_AGENT_DATA_DIR="+dataDir)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = os.Stderr

	c := &Client{
		cmd:     cmd,
		stdin:   stdin,
		pending: make(map[string]chan Envelope),
		subs:    make(map[uint64]func(Envelope)),
		done:    make(chan struct{}),
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi host: %w", err)
	}

	ready := make(chan error, 1)
	go c.readLoop(stdout, ready)
	select {
	case err := <-ready:
		if err != nil {
			_ = cmd.Process.Kill()
			return nil, err
		}
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		return nil, errors.New("pi host startup timed out")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	go func() {
		err := cmd.Wait()
		if err != nil {
			c.setError(fmt.Errorf("pi host exited: %w", err))
		}
		close(c.done)
		c.failPending()
	}()
	return c, nil
}

func (c *Client) readLoop(stdout io.Reader, ready chan<- error) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	readySent := false
	for scanner.Scan() {
		var message Envelope
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			log.Printf("pi host emitted invalid JSON: %v", err)
			continue
		}
		if message.Type == "host_ready" && !readySent {
			ready <- nil
			readySent = true
			continue
		}
		if message.Type == "response" {
			c.pendingMu.Lock()
			ch := c.pending[message.ID]
			delete(c.pending, message.ID)
			c.pendingMu.Unlock()
			if ch != nil {
				ch <- message
				close(ch)
			}
			continue
		}
		if message.Type == "event" {
			c.subsMu.RLock()
			callbacks := make([]func(Envelope), 0, len(c.subs))
			for _, callback := range c.subs {
				callbacks = append(callbacks, callback)
			}
			c.subsMu.RUnlock()
			for _, callback := range callbacks {
				callback(message)
			}
		}
	}
	if !readySent {
		ready <- fmt.Errorf("pi host stopped before ready: %w", scanner.Err())
	}
	if err := scanner.Err(); err != nil {
		c.setError(err)
	}
}

func (c *Client) Call(ctx context.Context, method string, params map[string]any, result any) error {
	if err := c.Err(); err != nil {
		return err
	}
	id := fmt.Sprintf("go-%d", c.nextID.Add(1))
	ch := make(chan Envelope, 1)
	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	payload, err := json.Marshal(request{ID: id, Method: method, Params: params})
	if err == nil {
		c.writeMu.Lock()
		_, err = c.stdin.Write(append(payload, '\n'))
		c.writeMu.Unlock()
	}
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return err
	}

	select {
	case response := <-ch:
		if !response.Success {
			return errors.New(response.Error)
		}
		if result != nil && len(response.Result) > 0 {
			return json.Unmarshal(response.Result, result)
		}
		return nil
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return ctx.Err()
	case <-c.done:
		return c.Err()
	}
}

func (c *Client) Subscribe(callback func(Envelope)) func() {
	id := c.nextID.Add(1)
	c.subsMu.Lock()
	c.subs[id] = callback
	c.subsMu.Unlock()
	return func() {
		c.subsMu.Lock()
		delete(c.subs, id)
		c.subsMu.Unlock()
	}
}

func (c *Client) Done() <-chan struct{} { return c.done }

func (c *Client) Close() error {
	_ = c.stdin.Close()
	if c.cmd.Process != nil {
		_ = c.cmd.Process.Signal(os.Interrupt)
	}
	select {
	case <-c.done:
		return nil
	case <-time.After(5 * time.Second):
		return c.cmd.Process.Kill()
	}
}

func (c *Client) Err() error {
	if p := c.err.Load(); p != nil {
		return *p
	}
	return nil
}

func (c *Client) setError(err error) {
	c.err.CompareAndSwap(nil, &err)
}

func (c *Client) failPending() {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
}
