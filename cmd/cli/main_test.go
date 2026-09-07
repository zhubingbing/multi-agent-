package main

import (
	"os"
	"testing"
)

func TestDefaultControlURLDerivesHTTPOriginFromRuntimeWebSocket(t *testing.T) {
	t.Setenv("MULTI_AGENT_CONTROL_URL", "")
	t.Setenv("MULTI_AGENT_SERVER_URL", "ws://control:30146/api/multi-agent/runtime/ws")
	if got := defaultControlURL(); got != "http://control:30146" {
		t.Fatalf("default control URL = %q", got)
	}
}

func TestParseOptionsAllowsGlobalFlagsAfterCommand(t *testing.T) {
	t.Setenv("MULTI_AGENT_CONTROL_URL", "http://default:30146")
	opts, err := parseOptions([]string{"automation", "list", "--output", "json", "--server", "http://control:9999"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.output != "json" || opts.server != "http://control:9999" || len(opts.args) != 2 {
		t.Fatalf("unexpected options: %#v", opts)
	}
}

func TestReadJSONFile(t *testing.T) {
	path := t.TempDir() + "/automation.json"
	if err := os.WriteFile(path, []byte(`{"name":"Daily","action":{"kind":"agent_prompt"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := readJSONFile(path, &value); err != nil {
		t.Fatal(err)
	}
	if value["name"] != "Daily" {
		t.Fatalf("decoded value = %#v", value)
	}
}
