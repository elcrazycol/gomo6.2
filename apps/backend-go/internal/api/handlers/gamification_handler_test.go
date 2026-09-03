package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/gamification"
	"github.com/gomo6/backend/internal/testutil"
)

func setupGamificationHandler() *GamificationHandler {
	gin.SetMode(gin.TestMode)
	return NewGamificationHandler()
}

// marshalData extracts the `data` object from a models.SuccessResponse body.
func unmarshalData(t *testing.T, body string, out any) {
	t.Helper()
	var resp struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v (body: %s)", err, body)
	}
	if !resp.Success {
		t.Fatalf("expected success=true, body: %s", body)
	}
	if err := json.Unmarshal(resp.Data, out); err != nil {
		t.Fatalf("failed to unmarshal data: %v (body: %s)", err, body)
	}
}

func TestGamificationCatalog(t *testing.T) {
	h := setupGamificationHandler()
	c, w := testutil.NewGETContext("/api/v1/gamification/catalog", nil)

	h.GetCatalog(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var data struct {
		Rarities []struct {
			Rarity string `json:"rarity"`
			Color  string `json:"color"`
		} `json:"rarities"`
		Mechanics []struct {
			Key    string `json:"key"`
			Config any    `json:"config"`
		} `json:"mechanics"`
	}
	unmarshalData(t, w.Body.String(), &data)
	if len(data.Rarities) != 7 {
		t.Errorf("rarities = %d, want 7", len(data.Rarities))
	}
	found := false
	for _, m := range data.Mechanics {
		if m.Key == gamification.RarityChestKey {
			found = true
			if m.Config == nil {
				t.Error("rarity_chest should expose its config")
			}
		}
	}
	if !found {
		t.Error("rarity_chest missing from mechanics catalog")
	}
	// Every rarity must carry a color hint.
	for _, r := range data.Rarities {
		if r.Color == "" {
			t.Errorf("rarity %q has no color", r.Rarity)
		}
	}
}

func TestGamificationStartChest(t *testing.T) {
	h := setupGamificationHandler()

	t.Run("default mechanic", func(t *testing.T) {
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/start", nil, nil, nil)
		h.StartChest(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
		}
		var data struct {
			State gamification.State `json:"state"`
		}
		unmarshalData(t, w.Body.String(), &data)
		if data.State.MechanicKey != gamification.RarityChestKey {
			t.Errorf("mechanic key = %q, want %q", data.State.MechanicKey, gamification.RarityChestKey)
		}
		if data.State.Rarity != gamification.RarityCommon {
			t.Errorf("start rarity = %q, want common", data.State.Rarity)
		}
		if data.State.AttemptsLeft != 5 {
			t.Errorf("attempts = %d, want 5", data.State.AttemptsLeft)
		}
		if data.State.Opened {
			t.Error("fresh chest must be sealed")
		}
	})

	t.Run("unknown mechanic", func(t *testing.T) {
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/start",
			map[string]string{"mechanic": "no_such"}, nil, nil)
		h.StartChest(c)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
		}
	})
}

func TestGamificationTapChest(t *testing.T) {
	h := setupGamificationHandler()

	// Fresh chest state as Start would produce.
	startState, _ := gamification.Start(gamification.RarityChestKey)

	t.Run("forced upgrade climbs one rung", func(t *testing.T) {
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
			map[string]any{"state": startState, "force": "upgrade"}, nil, nil)
		h.TapChest(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
		}
		var data struct {
			State  gamification.State `json:"state"`
			Event  gamification.Event `json:"event"`
			Chance float64            `json:"chance"`
		}
		unmarshalData(t, w.Body.String(), &data)
		if data.Event.Type != gamification.EventUpgraded {
			t.Errorf("event = %q, want upgraded", data.Event.Type)
		}
		if data.State.Rarity != gamification.RarityUnusual {
			t.Errorf("rarity after upgrade = %q, want unusual", data.State.Rarity)
		}
		if data.State.AttemptsLeft != 5 {
			t.Errorf("attempts after success = %d, want 5 (reset)", data.State.AttemptsLeft)
		}
		if data.Chance <= 0 {
			t.Errorf("chance = %v, want positive", data.Chance)
		}
	})

	t.Run("five forced fails open the chest", func(t *testing.T) {
		s := startState
		for i := 0; i < 5; i++ {
			c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
				map[string]any{"state": s, "force": "fail"}, nil, nil)
			h.TapChest(c)
			if w.Code != http.StatusOK {
				t.Fatalf("tap %d: status = %d (body: %s)", i+1, w.Code, w.Body.String())
			}
			var data struct {
				State gamification.State `json:"state"`
				Event gamification.Event `json:"event"`
			}
			unmarshalData(t, w.Body.String(), &data)
			if i < 4 && data.Event.Type != gamification.EventFailed {
				t.Fatalf("tap %d: event = %q, want failed", i+1, data.Event.Type)
			}
			if i == 4 && data.Event.Type != gamification.EventOpened {
				t.Fatalf("tap %d: event = %q, want opened", i+1, data.Event.Type)
			}
			s = data.State
		}
		if !s.Opened {
			t.Fatal("chest should be opened after five fails")
		}
		if s.FinalRarity != gamification.RarityCommon {
			t.Errorf("final rarity = %q, want common", s.FinalRarity)
		}
	})

	t.Run("forced fail respects attempts", func(t *testing.T) {
		s := startState
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
			map[string]any{"state": s, "force": "fail"}, nil, nil)
		h.TapChest(c)
		var data struct {
			State gamification.State `json:"state"`
			Event gamification.Event `json:"event"`
		}
		unmarshalData(t, w.Body.String(), &data)
		if data.State.AttemptsLeft != 4 {
			t.Errorf("attempts = %d, want 4", data.State.AttemptsLeft)
		}
		if data.Event.Type != gamification.EventFailed {
			t.Errorf("event = %q, want failed", data.Event.Type)
		}
	})

	t.Run("explicit roll", func(t *testing.T) {
		s := startState
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
			map[string]any{"state": s, "force": "roll", "roll": 0.0}, nil, nil)
		h.TapChest(c)
		var data struct {
			State gamification.State `json:"state"`
			Event gamification.Event `json:"event"`
		}
		unmarshalData(t, w.Body.String(), &data)
		if data.Event.Type != gamification.EventUpgraded {
			t.Errorf("roll=0 event = %q, want upgraded (0 < chance)", data.Event.Type)
		}
	})

	t.Run("random roll always returns a valid event", func(t *testing.T) {
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
			map[string]any{"state": startState}, nil, nil)
		h.TapChest(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
		}
		var data struct {
			Event gamification.Event `json:"event"`
		}
		unmarshalData(t, w.Body.String(), &data)
		switch data.Event.Type {
		case gamification.EventUpgraded, gamification.EventFailed:
		default:
			t.Errorf("unexpected event type %q", data.Event.Type)
		}
	})

	t.Run("tap on opened chest is a no-op", func(t *testing.T) {
		opened := startState
		opened.Opened = true
		opened.FinalRarity = gamification.RarityCommon
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
			map[string]any{"state": opened}, nil, nil)
		h.TapChest(c)
		var data struct {
			State gamification.State `json:"state"`
			Event gamification.Event `json:"event"`
		}
		unmarshalData(t, w.Body.String(), &data)
		if data.State.Opened != true || data.Event.Type != gamification.EventOpened {
			t.Errorf("opened chest must stay opened, got state=%+v event=%+v", data.State, data.Event)
		}
	})

	t.Run("unknown mechanic", func(t *testing.T) {
		bad := startState
		bad.MechanicKey = "no_such"
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap",
			map[string]any{"state": bad}, nil, nil)
		h.TapChest(c)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
		}
	})

	t.Run("malformed body", func(t *testing.T) {
		c, w := testutil.NewPOSTContext("/api/v1/gamification/chests/tap", nil, nil, nil)
		c.Request.Body = io.NopCloser(strings.NewReader(`{"state":`))
		h.TapChest(c)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
		}
	})
}
