package controlclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"multi-agent/internal/automation"
)

type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

func (c *Client) do(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, body)
	if err != nil {
		return err
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		request.Header.Set("Authorization", "Bearer "+c.Token)
	}
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return fmt.Errorf("control API %s: %s", response.Status, strings.TrimSpace(string(message)))
	}
	if output == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(output)
}

func (c *Client) ListAutomations(ctx context.Context, includeArchived bool) ([]automation.Automation, error) {
	path := "/api/multi-agent/automations"
	if includeArchived {
		path += "?includeArchived=true"
	}
	var response struct {
		Automations []automation.Automation `json:"automations"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &response)
	return response.Automations, err
}

func (c *Client) GetAutomation(ctx context.Context, id string) (automation.Automation, error) {
	var response struct {
		Automation automation.Automation `json:"automation"`
	}
	err := c.do(ctx, http.MethodGet, "/api/multi-agent/automations/"+id, nil, &response)
	return response.Automation, err
}

func (c *Client) CreateAutomation(ctx context.Context, request automation.CreateRequest) (automation.Automation, error) {
	var response struct {
		Automation automation.Automation `json:"automation"`
	}
	err := c.do(ctx, http.MethodPost, "/api/multi-agent/automations", request, &response)
	return response.Automation, err
}

func (c *Client) UpdateAutomation(ctx context.Context, id string, request automation.UpdateRequest) (automation.Automation, error) {
	var response struct {
		Automation automation.Automation `json:"automation"`
	}
	err := c.do(ctx, http.MethodPatch, "/api/multi-agent/automations/"+id, request, &response)
	return response.Automation, err
}

func (c *Client) RunAutomation(ctx context.Context, id string) (automation.Run, error) {
	var response struct {
		Run automation.Run `json:"run"`
	}
	err := c.do(ctx, http.MethodPost, "/api/multi-agent/automations/"+id+"/run", nil, &response)
	return response.Run, err
}

func (c *Client) ListAutomationRuns(ctx context.Context, automationID string) ([]automation.Run, error) {
	path := "/api/multi-agent/automation-runs"
	if automationID != "" {
		path += "?automationId=" + url.QueryEscape(automationID)
	}
	var response struct {
		Runs []automation.Run `json:"runs"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &response)
	return response.Runs, err
}

func (c *Client) SetAutomationState(ctx context.Context, id, action string) (automation.Automation, error) {
	var response struct {
		Automation automation.Automation `json:"automation"`
	}
	err := c.do(ctx, http.MethodPost, "/api/multi-agent/automations/"+id+"/"+action, nil, &response)
	return response.Automation, err
}
