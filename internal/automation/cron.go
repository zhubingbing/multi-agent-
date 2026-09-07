package automation

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Cron is the standard five-field cron form: minute hour day-of-month month day-of-week.
type Cron struct {
	minute field
	hour   field
	day    field
	month  field
	week   field
}

type field struct {
	values map[int]bool
	wild   bool
}

func ParseCron(expression string) (Cron, error) {
	parts := strings.Fields(strings.TrimSpace(expression))
	if len(parts) != 5 {
		return Cron{}, fmt.Errorf("cron must contain five fields: minute hour day-of-month month day-of-week")
	}
	minute, err := parseCronField(parts[0], 0, 59, false)
	if err != nil {
		return Cron{}, fmt.Errorf("invalid cron minute: %w", err)
	}
	hour, err := parseCronField(parts[1], 0, 23, false)
	if err != nil {
		return Cron{}, fmt.Errorf("invalid cron hour: %w", err)
	}
	day, err := parseCronField(parts[2], 1, 31, false)
	if err != nil {
		return Cron{}, fmt.Errorf("invalid cron day-of-month: %w", err)
	}
	month, err := parseCronField(parts[3], 1, 12, false)
	if err != nil {
		return Cron{}, fmt.Errorf("invalid cron month: %w", err)
	}
	week, err := parseCronField(parts[4], 0, 7, true)
	if err != nil {
		return Cron{}, fmt.Errorf("invalid cron day-of-week: %w", err)
	}
	return Cron{minute: minute, hour: hour, day: day, month: month, week: week}, nil
}

func parseCronField(value string, min, max int, sundaySeven bool) (field, error) {
	result := field{values: map[int]bool{}}
	value = strings.TrimSpace(value)
	if value == "" {
		return result, fmt.Errorf("empty field")
	}
	if value == "*" {
		result.wild = true
		for n := min; n <= max; n++ {
			if sundaySeven && n == 7 {
				continue
			}
			result.values[n] = true
		}
		return result, nil
	}
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			return result, fmt.Errorf("empty list item")
		}
		base, stepText, hasStep := strings.Cut(item, "/")
		step := 1
		if hasStep {
			var err error
			step, err = strconv.Atoi(stepText)
			if err != nil || step <= 0 || step > max-min+1 {
				return result, fmt.Errorf("invalid step %q", stepText)
			}
		}
		start, end := min, max
		switch {
		case base == "*":
		case strings.Contains(base, "-"):
			left, right, ok := strings.Cut(base, "-")
			if !ok {
				return result, fmt.Errorf("invalid range")
			}
			var err error
			start, err = strconv.Atoi(left)
			if err != nil {
				return result, fmt.Errorf("invalid range start")
			}
			end, err = strconv.Atoi(right)
			if err != nil {
				return result, fmt.Errorf("invalid range end")
			}
		default:
			if hasStep {
				return result, fmt.Errorf("step requires * or range")
			}
			parsed, err := strconv.Atoi(base)
			if err != nil {
				return result, fmt.Errorf("invalid value %q", base)
			}
			start, end = parsed, parsed
		}
		if start < min || end > max || start > end {
			return result, fmt.Errorf("range %d-%d outside %d-%d", start, end, min, max)
		}
		for n := start; n <= end; n += step {
			if sundaySeven && n == 7 {
				n = 0
			}
			result.values[n] = true
			if sundaySeven && n == 0 && end == 7 {
				break
			}
		}
	}
	return result, nil
}

func (c Cron) Next(after time.Time, location *time.Location) time.Time {
	current := after.In(location).Truncate(time.Minute).Add(time.Minute)
	// A two-year search bounds malformed-but-valid schedules such as Feb 29.
	for remaining := 2 * 366 * 24 * 60; remaining > 0; remaining-- {
		if c.matches(current) {
			return current
		}
		current = current.Add(time.Minute)
	}
	return time.Time{}
}

func (c Cron) matches(value time.Time) bool {
	if !c.minute.values[value.Minute()] || !c.hour.values[value.Hour()] || !c.month.values[int(value.Month())] {
		return false
	}
	dom := c.day.values[value.Day()]
	dow := c.week.values[int(value.Weekday())]
	// Vixie cron applies DOM/DOW as OR when both are explicitly restricted.
	dayMatches := dom && dow
	if c.day.wild {
		dayMatches = dow
	}
	if c.week.wild {
		dayMatches = dom
	}
	if !c.day.wild && !c.week.wild {
		dayMatches = dom || dow
	}
	return dayMatches
}
