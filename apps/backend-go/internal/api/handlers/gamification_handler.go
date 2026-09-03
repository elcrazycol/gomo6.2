package handlers

import (
	"crypto/rand"
	"encoding/binary"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/gamification"
	"github.com/gomo6/backend/internal/models"
)

// GamificationHandler exposes the pure gamification engine over HTTP. It is
// deliberately stateless: chest sessions round-trip as their State value, so
// nothing is stored server-side. Meant as the dev-dashboard playground
// surface (and later the production API); auth/gating is out of scope for the
// playground phase.
type GamificationHandler struct{}

// NewGamificationHandler wires the handler. No dependencies — the engine is
// self-contained and stateless.
func NewGamificationHandler() *GamificationHandler {
	return &GamificationHandler{}
}

// fixedSource is a gamification.Source that always returns the same roll.
type fixedSource float64

func (f fixedSource) Float64() float64 { return float64(f) }

// randomSource is a gamification.Source backed by crypto/rand so server
// rolls are unpredictable even on this open surface.
type randomSource struct{}

func (randomSource) Float64() float64 {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return 0.5 // unreachable in practice; never block a chest tap on entropy
	}
	return float64(binary.BigEndian.Uint64(buf[:])) / float64(math.MaxUint64+1)
}

// gamificationRequest holds the mechanic key selectors shared by catalog-ish
// endpoints.
type gamificationRequest struct {
	Mechanic string `json:"mechanic"`
}

// tapRequest is the body of POST /gamification/chests/tap.
type tapRequest struct {
	State gamification.State `json:"state"`
	// Force: "" | "random" | "upgrade" | "fail" | "roll"
	Force string  `json:"force"`
	Roll  float64 `json:"roll"` // used when force == "roll"
}

// GetCatalog godoc
// @Summary      Gamification catalog
// @Description  Registered chest mechanics with their static config plus the rarity ladder with colors.
// @Tags         Gamification
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Router       /gamification/catalog [get]
func (h *GamificationHandler) GetCatalog(c *gin.Context) {
	rarities := make([]gin.H, 0, len(gamification.AllRarities()))
	for _, r := range gamification.AllRarities() {
		rarities = append(rarities, gin.H{
			"rarity": r,
			"color":  gamification.RarityColorFor(r),
		})
	}

	mechanics := []gin.H{}
	for _, key := range gamification.RegisteredKeys() {
		m, _ := gamification.Lookup(key)
		entry := gin.H{"key": key}
		if d, ok := m.(gamification.Describable); ok {
			entry["config"] = d.Describe()
		}
		mechanics = append(mechanics, entry)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"rarities":  rarities,
		"mechanics": mechanics,
	}))
}

// StartChest godoc
// @Summary      Start a chest
// @Description  Spawn a fresh chest session (state round-trips to the client).
// @Tags         Gamification
// @Accept       json
// @Produce      json
// @Param        body body gamificationRequest false "Mechanic key (default: rarity_chest)"
// @Success      200 {object} models.APIResponse
// @Router       /gamification/chests/start [post]
func (h *GamificationHandler) StartChest(c *gin.Context) {
	var req gamificationRequest
	if c.Request.Body != nil {
		_ = c.ShouldBindJSON(&req)
	}
	key := req.Mechanic
	if key == "" {
		key = gamification.RarityChestKey
	}

	state, err := gamification.Start(key)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"state": state}))
}

// TapChest godoc
// @Summary      Tap a chest
// @Description  Advance a chest session by one tap. The state is round-tripped by the client; force may override the roll for deterministic testing.
// @Tags         Gamification
// @Accept       json
// @Produce      json
// @Param        body body tapRequest true "Chest state + force mode"
// @Success      200 {object} models.APIResponse
// @Router       /gamification/chests/tap [post]
func (h *GamificationHandler) TapChest(c *gin.Context) {
	var req tapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	m, ok := gamification.Lookup(req.State.MechanicKey)
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Unknown mechanic: "+req.State.MechanicKey))
		return
	}

	// Resolve the roll: forced modes need the mechanic's current chance, which
	// only rarity-style mechanics provide (via ChanceProvider). Anything else
	// falls back to a plain random roll.
	var src gamification.Source = randomSource{}
	chance, hasChance := 0.0, false
	if cp, ok := m.(gamification.ChanceProvider); ok {
		chance, hasChance = cp.ChanceFor(req.State)
	}

	switch req.Force {
	case "upgrade":
		if hasChance && chance > 0 {
			// A roll of 0 is always < chance, so this guarantees an upgrade
			// whenever the tier is upgradeable.
			src = fixedSource(0)
		} else {
			// Tier can't be upgraded (chance 0 or top rarity) — fall back to
			// the same random roll the engine would do.
			src = randomSource{}
		}
	case "fail":
		if hasChance {
			// A roll >= chance guarantees a fail (chance is in [0,1]).
			src = fixedSource(math.Min(chance+0.0001, 1))
		} else {
			src = fixedSource(1)
		}
	case "roll":
		src = fixedSource(math.Max(0, math.Min(1, req.Roll)))
	}

	next, ev := m.Step(req.State, src)
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"state":  next,
		"event":  ev,
		"chance": chance,
	}))
}
