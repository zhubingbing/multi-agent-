package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"multi-agent/internal/automation"
	"multi-agent/internal/controlclient"
)

type options struct {
	server string
	token  string
	output string
	args   []string
}

func defaultControlURL() string {
	if value := strings.TrimSpace(os.Getenv("MULTI_AGENT_CONTROL_URL")); value != "" {
		return value
	}
	value := strings.TrimSpace(os.Getenv("MULTI_AGENT_SERVER_URL"))
	if value == "" {
		return "http://127.0.0.1:30146"
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}
	if parsed.Scheme == "ws" {
		parsed.Scheme = "http"
	} else if parsed.Scheme == "wss" {
		parsed.Scheme = "https"
	}
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func parseOptions(args []string) (options, error) {
	result := options{
		server: defaultControlURL(),
		token:  os.Getenv("MULTI_AGENT_TOKEN"),
		output: "table",
	}
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--server":
			index++
			if index >= len(args) {
				return result, errors.New("--server requires a value")
			}
			result.server = args[index]
		case "--token":
			index++
			if index >= len(args) {
				return result, errors.New("--token requires a value")
			}
			result.token = args[index]
		case "--output":
			index++
			if index >= len(args) {
				return result, errors.New("--output requires a value")
			}
			result.output = args[index]
		default:
			result.args = append(result.args, args[index])
		}
	}
	if result.output != "table" && result.output != "json" {
		return result, errors.New("--output must be table or json")
	}
	return result, nil
}

func readJSONFile(path string, output any) error {
	var content []byte
	var err error
	if path == "-" {
		content, err = os.ReadFile("/dev/stdin")
	} else {
		content, err = os.ReadFile(path)
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(content, output); err != nil {
		return fmt.Errorf("decode %s as JSON: %w", path, err)
	}
	return nil
}

func fileArgument(args []string) (string, error) {
	for index := 0; index < len(args); index++ {
		if args[index] == "--file" {
			if index+1 >= len(args) {
				return "", errors.New("--file requires a value")
			}
			return args[index+1], nil
		}
	}
	return "", errors.New("--file is required (JSON; use - for stdin)")
}

func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func printAutomations(items []automation.Automation) {
	writer := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(writer, "ID\tSTATUS\tACTION\tNAME")
	for _, item := range items {
		fmt.Fprintf(writer, "%s\t%s\t%s\t%s\n", item.ID, item.Status, item.ActionType, item.Name)
	}
	_ = writer.Flush()
}

func printAutomationRuns(items []automation.Run) {
	writer := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(writer, "ID\tSTATUS\tSOURCE\tCONVERSATION")
	for _, item := range items {
		fmt.Fprintf(writer, "%s\t%s\t%s\t%s\n", item.ID, item.Status, item.Source, item.ConversationID)
	}
	_ = writer.Flush()
}

func printAutomation(item automation.Automation) {
	fmt.Printf("ID:      %s\nName:    %s\nStatus:  %s\nAction:  %s\nOutput:  %s\nVersion: %d\n",
		item.ID, item.Name, item.Status, item.ActionType, item.OutputMode, item.RuleVersion)
	if item.Action.Kind == automation.ActionAgentPrompt {
		fmt.Printf("Agent:   %s\nRunbook: %s\n", item.Action.AgentID, item.Action.Runbook)
	} else {
		fmt.Printf("Runtime: %s\nLanguage:%s\nSource:  %s\n", item.Action.RuntimeID, item.Action.Language, item.Action.Source)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `Usage:
  multi-agent automation list [--include-archived] [--output json]
  multi-agent automation get <id> [--output json]
  multi-agent automation create --file <definition.json|-> [--output json]
  multi-agent automation update <id> --file <patch.json|-> [--output json]
  multi-agent automation run <id> [--output json]
  multi-agent automation runs [id] [--output json]
  multi-agent automation pause|resume|archive <id> [--output json]

Connection: --server URL, --token TOKEN, or MULTI_AGENT_SERVER_URL/MULTI_AGENT_TOKEN.`)
}

func run(ctx context.Context, opts options) error {
	if len(opts.args) < 2 || opts.args[0] != "automation" {
		usage()
		return errors.New("an automation command is required")
	}
	client := &controlclient.Client{BaseURL: opts.server, Token: opts.token}
	command := opts.args[1]
	switch command {
	case "list":
		includeArchived := false
		for _, arg := range opts.args[2:] {
			if arg == "--include-archived" {
				includeArchived = true
			}
		}
		items, err := client.ListAutomations(ctx, includeArchived)
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"automations": items})
		}
		printAutomations(items)
		return nil
	case "get":
		if len(opts.args) < 3 {
			return errors.New("automation get requires an id")
		}
		item, err := client.GetAutomation(ctx, opts.args[2])
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"automation": item})
		}
		printAutomation(item)
		return nil
	case "create":
		path, err := fileArgument(opts.args[2:])
		if err != nil {
			return err
		}
		var request automation.CreateRequest
		if err := readJSONFile(path, &request); err != nil {
			return err
		}
		item, err := client.CreateAutomation(ctx, request)
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"automation": item})
		}
		printAutomation(item)
		return nil
	case "update":
		if len(opts.args) < 3 {
			return errors.New("automation update requires an id")
		}
		path, err := fileArgument(opts.args[3:])
		if err != nil {
			return err
		}
		var request automation.UpdateRequest
		if err := readJSONFile(path, &request); err != nil {
			return err
		}
		item, err := client.UpdateAutomation(ctx, opts.args[2], request)
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"automation": item})
		}
		printAutomation(item)
		return nil
	case "run":
		if len(opts.args) < 3 {
			return errors.New("automation run requires an id")
		}
		run, err := client.RunAutomation(ctx, opts.args[2])
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"run": run})
		}
		printAutomationRuns([]automation.Run{run})
		return nil
	case "runs":
		automationID := ""
		if len(opts.args) >= 3 {
			automationID = opts.args[2]
		}
		runs, err := client.ListAutomationRuns(ctx, automationID)
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"runs": runs})
		}
		printAutomationRuns(runs)
		return nil
	case "pause", "resume", "archive":
		if len(opts.args) < 3 {
			return fmt.Errorf("automation %s requires an id", command)
		}
		item, err := client.SetAutomationState(ctx, opts.args[2], command)
		if err != nil {
			return err
		}
		if opts.output == "json" {
			return printJSON(map[string]any{"automation": item})
		}
		printAutomation(item)
		return nil
	default:
		usage()
		return fmt.Errorf("unknown automation command %q", command)
	}
}

func main() {
	opts, err := parseOptions(os.Args[1:])
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		err = run(ctx, opts)
	}
	if err == nil {
		return
	}
	if opts.output == "json" {
		_ = printJSON(map[string]any{"ok": false, "error": map[string]string{"code": "command_failed", "message": strings.TrimSpace(err.Error())}})
	} else {
		fmt.Fprintln(os.Stderr, "Error:", err)
	}
	os.Exit(1)
}
