package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

type GiftAdminHandler struct {
	db *sql.DB
}

func NewGiftAdminHandler(db *sql.DB) *GiftAdminHandler {
	return &GiftAdminHandler{db: db}
}

func (h *GiftAdminHandler) isAdmin(userID string) bool {
	var count int
	h.db.QueryRow(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`, userID).Scan(&count)
	return count > 0
}

// ListGifts — GET /api/v1/admin/gifts (admin only, includes inactive)
//
// ListGifts godoc
// @Summary      List all gifts (admin)
// @Description  List all gifts including inactive ones (admin only)
// @Tags         Admin
// @Produce      json
// @Param        limit  query int false "Max results" default(100)
// @Param        offset query int false "Offset for pagination"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /admin/gifts [get]
// @Security     BearerAuth
func (h *GiftAdminHandler) ListGifts(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	limit := 100
	offset := 0
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}

	rows, err := h.db.Query(`
		SELECT id, name, description, image_url, price, category,
		       is_active, is_limited, max_quantity, sold_count, sort_order,
		       COALESCE(is_upgradable, FALSE), upgrade_cost,
		       created_at, updated_at
		FROM gift_catalog
		ORDER BY sort_order ASC, created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var gifts []models.GiftCatalog
	for rows.Next() {
		var g models.GiftCatalog
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.ImageURL, &g.Price, &g.Category,
			&g.IsActive, &g.IsLimited, &g.MaxQuantity, &g.SoldCount, &g.SortOrder,
			&g.IsUpgradable, &g.UpgradeCost,
			&g.CreatedAt, &g.UpdatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		gifts = append(gifts, g)
	}

	if gifts == nil {
		gifts = []models.GiftCatalog{}
	}

	c.JSON(http.StatusOK, models.SuccessResponseWithCount(gifts, len(gifts)))
}

// CreateGift — POST /api/v1/admin/gifts (admin only)
//
// CreateGift godoc
// @Summary      Create gift (admin)
// @Description  Create a new gift in the catalog (admin only)
// @Tags         Admin
// @Accept       json
// @Produce      json
// @Param        request body object true "Gift data"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /admin/gifts [post]
// @Security     BearerAuth
func (h *GiftAdminHandler) CreateGift(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	var req struct {
		Name         string `json:"name" binding:"required"`
		Description  string `json:"description"`
		ImageURL     string `json:"image_url" binding:"required"`
		Price        int    `json:"price" binding:"required,gt=0"`
		Category     string `json:"category"`
		IsActive     *bool  `json:"is_active"`
		IsLimited    *bool  `json:"is_limited"`
		MaxQuantity  *int   `json:"max_quantity"`
		SortOrder    *int   `json:"sort_order"`
		IsUpgradable *bool  `json:"is_upgradable"`
		UpgradeCost  *int   `json:"upgrade_cost"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	isLimited := false
	if req.IsLimited != nil {
		isLimited = *req.IsLimited
	}
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	category := req.Category
	if category == "" {
		category = "general"
	}

	isUpgradable := false
	if req.IsUpgradable != nil {
		isUpgradable = *req.IsUpgradable
	}
	var g models.GiftCatalog
	err := h.db.QueryRow(`
		INSERT INTO gift_catalog (name, description, image_url, price, category, is_active, is_limited, max_quantity, sort_order, is_upgradable, upgrade_cost)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, name, description, image_url, price, category, is_active, is_limited, max_quantity, sold_count, sort_order, COALESCE(is_upgradable, FALSE), upgrade_cost, created_at, updated_at
	`, req.Name, req.Description, req.ImageURL, req.Price, category, isActive, isLimited, req.MaxQuantity, sortOrder, isUpgradable, req.UpgradeCost).Scan(
		&g.ID, &g.Name, &g.Description, &g.ImageURL, &g.Price, &g.Category,
		&g.IsActive, &g.IsLimited, &g.MaxQuantity, &g.SoldCount, &g.SortOrder,
		&g.IsUpgradable, &g.UpgradeCost,
		&g.CreatedAt, &g.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(g))
}

// UpdateGift — PUT /api/v1/admin/gifts/:id (admin only)
//
// UpdateGift godoc
// @Summary      Update gift (admin)
// @Description  Update a gift in the catalog (admin only)
// @Tags         Admin
// @Accept       json
// @Produce      json
// @Param        id path string true "Gift ID"
// @Param        request body object true "Fields to update"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /admin/gifts/{id} [put]
// @Security     BearerAuth
func (h *GiftAdminHandler) UpdateGift(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	giftID := c.Param("id")

	var req struct {
		Name         *string `json:"name"`
		Description  *string `json:"description"`
		ImageURL     *string `json:"image_url"`
		Price        *int    `json:"price"`
		Category     *string `json:"category"`
		IsActive     *bool   `json:"is_active"`
		IsLimited    *bool   `json:"is_limited"`
		MaxQuantity  *int    `json:"max_quantity"`
		SortOrder    *int    `json:"sort_order"`
		IsUpgradable *bool   `json:"is_upgradable"`
		UpgradeCost  *int    `json:"upgrade_cost"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	query := "UPDATE gift_catalog SET updated_at = NOW()"
	var args []interface{}
	argIndex := 1

	if req.Name != nil {
		query += ", name = $" + strconv.Itoa(argIndex)
		args = append(args, *req.Name)
		argIndex++
	}
	if req.Description != nil {
		query += ", description = $" + strconv.Itoa(argIndex)
		args = append(args, *req.Description)
		argIndex++
	}
	if req.ImageURL != nil {
		query += ", image_url = $" + strconv.Itoa(argIndex)
		args = append(args, *req.ImageURL)
		argIndex++
	}
	if req.Price != nil {
		query += ", price = $" + strconv.Itoa(argIndex)
		args = append(args, *req.Price)
		argIndex++
	}
	if req.Category != nil {
		query += ", category = $" + strconv.Itoa(argIndex)
		args = append(args, *req.Category)
		argIndex++
	}
	if req.IsActive != nil {
		query += ", is_active = $" + strconv.Itoa(argIndex)
		args = append(args, *req.IsActive)
		argIndex++
	}
	if req.IsLimited != nil {
		query += ", is_limited = $" + strconv.Itoa(argIndex)
		args = append(args, *req.IsLimited)
		argIndex++
	}
	if req.MaxQuantity != nil {
		query += ", max_quantity = $" + strconv.Itoa(argIndex)
		args = append(args, *req.MaxQuantity)
		argIndex++
	}
	if req.SortOrder != nil {
		query += ", sort_order = $" + strconv.Itoa(argIndex)
		args = append(args, *req.SortOrder)
		argIndex++
	}
	if req.IsUpgradable != nil {
		query += ", is_upgradable = $" + strconv.Itoa(argIndex)
		args = append(args, *req.IsUpgradable)
		argIndex++
	}
	if req.UpgradeCost != nil {
		query += ", upgrade_cost = $" + strconv.Itoa(argIndex)
		args = append(args, *req.UpgradeCost)
		argIndex++
	}

	query += " WHERE id = $" + strconv.Itoa(argIndex)
	args = append(args, giftID)

	_, err := h.db.Exec(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Return updated gift
	var g models.GiftCatalog
	err = h.db.QueryRow(`
		SELECT id, name, description, image_url, price, category,
		       is_active, is_limited, max_quantity, sold_count, sort_order,
		       COALESCE(is_upgradable, FALSE), upgrade_cost,
		       created_at, updated_at
		FROM gift_catalog WHERE id = $1
	`, giftID).Scan(
		&g.ID, &g.Name, &g.Description, &g.ImageURL, &g.Price, &g.Category,
		&g.IsActive, &g.IsLimited, &g.MaxQuantity, &g.SoldCount, &g.SortOrder,
		&g.IsUpgradable, &g.UpgradeCost,
		&g.CreatedAt, &g.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(g))
}

// DeleteGift — DELETE /api/v1/admin/gifts/:id (admin only, soft delete)
//
// DeleteGift godoc
// @Summary      Delete gift (admin)
// @Description  Soft-delete a gift by setting is_active=false (admin only)
// @Tags         Admin
// @Produce      json
// @Param        id path string true "Gift ID"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /admin/gifts/{id} [delete]
// @Security     BearerAuth
func (h *GiftAdminHandler) DeleteGift(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	giftID := c.Param("id")

	_, err := h.db.Exec(`UPDATE gift_catalog SET is_active = false, updated_at = NOW() WHERE id = $1`, giftID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ---- Layer CRUD ----

// ListLayers — GET /api/v1/admin/gifts/:id/layers (admin only)
func (h *GiftAdminHandler) ListLayers(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	giftID := c.Param("id")

	rows, err := h.db.Query(`
		SELECT gl.id, gl.gift_catalog_id, gl.layer_type, gl.image_url,
		       COALESCE(gl.name, ''), gl.sort_order, gl.created_at,
		       (SELECT COUNT(*) FROM user_gifts ug WHERE (
		           ug.gift_layer_id = gl.id OR
		           ug.background_layer_id = gl.id OR
		           ug.symbol_layer_id = gl.id
		       ) AND ug.is_upgraded = TRUE)
		FROM gift_layers gl
		WHERE gl.gift_catalog_id = $1
		ORDER BY gl.layer_type, gl.sort_order, gl.created_at
	`, giftID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var layers []models.GiftLayer
	for rows.Next() {
		var l models.GiftLayer
		var name string
		err := rows.Scan(&l.ID, &l.GiftCatalogID, &l.LayerType, &l.ImageURL,
			&name, &l.SortOrder, &l.CreatedAt, &l.UsageCount)
		if err != nil {
			continue
		}
		if name != "" {
			l.Name = &name
		}
		layers = append(layers, l)
	}

	if layers == nil {
		layers = []models.GiftLayer{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(layers))
}

// CreateLayer — POST /api/v1/admin/gifts/:id/layers (admin only)
func (h *GiftAdminHandler) CreateLayer(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	giftID := c.Param("id")

	var req struct {
		LayerType string  `json:"layer_type" binding:"required"`
		ImageURL  string  `json:"image_url" binding:"required"`
		Name      *string `json:"name"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Validate layer type
	if req.LayerType != "gift" && req.LayerType != "background" && req.LayerType != "symbol" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("layer_type must be 'gift', 'background', or 'symbol'"))
		return
	}

	// Check gift exists
	var exists bool
	h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM gift_catalog WHERE id = $1)", giftID).Scan(&exists)
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Gift not found"))
		return
	}

	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	var l models.GiftLayer
	var nameVal string
	err := h.db.QueryRow(`
		INSERT INTO gift_layers (gift_catalog_id, layer_type, image_url, name, sort_order)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, gift_catalog_id, layer_type, image_url, COALESCE(name, ''), sort_order, created_at
	`, giftID, req.LayerType, req.ImageURL, req.Name, sortOrder).Scan(
		&l.ID, &l.GiftCatalogID, &l.LayerType, &l.ImageURL,
		&nameVal, &l.SortOrder, &l.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if nameVal != "" {
		l.Name = &nameVal
	}
	l.UsageCount = new(int)

	// Re-evaluate is_upgradable after adding a layer
	h.updateUpgradableFlag(giftID)

	c.JSON(http.StatusCreated, models.SuccessResponse(l))
}

// DeleteLayer — DELETE /api/v1/admin/gifts/:id/layers/:layerId (admin only)
func (h *GiftAdminHandler) DeleteLayer(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	if !h.isAdmin(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return
	}

	layerID := c.Param("layerId")

	// Verify layer exists
	var giftCatalogID string
	err := h.db.QueryRow("SELECT gift_catalog_id FROM gift_layers WHERE id = $1", layerID).Scan(&giftCatalogID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Layer not found"))
		return
	}

	// Check not used in any upgraded gift
	var usageCount int
	h.db.QueryRow(`
		SELECT COUNT(*) FROM user_gifts WHERE
		  (gift_layer_id = $1 OR background_layer_id = $1 OR symbol_layer_id = $1)
		  AND is_upgraded = TRUE
	`, layerID).Scan(&usageCount)
	if usageCount > 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(
			fmt.Sprintf("Layer is used in %d upgraded gift(s). Delete those first or use another image.", usageCount)))
		return
	}

	_, err = h.db.Exec("DELETE FROM gift_layers WHERE id = $1", layerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Update is_upgradable flag: must have ≥1 layer of each type to be upgradable
	h.updateUpgradableFlag(giftCatalogID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// updateUpgradableFlag sets is_upgradable = true when all 3 layer types exist.
func (h *GiftAdminHandler) updateUpgradableFlag(giftID string) {
	var giftCount, bgCount, symCount int
	h.db.QueryRow(`SELECT COUNT(*) FROM gift_layers WHERE gift_catalog_id = $1 AND layer_type = 'gift'`, giftID).Scan(&giftCount)
	h.db.QueryRow(`SELECT COUNT(*) FROM gift_layers WHERE gift_catalog_id = $1 AND layer_type = 'background'`, giftID).Scan(&bgCount)
	h.db.QueryRow(`SELECT COUNT(*) FROM gift_layers WHERE gift_catalog_id = $1 AND layer_type = 'symbol'`, giftID).Scan(&symCount)
	isUpgradable := giftCount > 0 && bgCount > 0 && symCount > 0
	h.db.Exec(`UPDATE gift_catalog SET is_upgradable = $1, updated_at = NOW() WHERE id = $2`, isUpgradable, giftID)
}
