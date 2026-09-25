package wall

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gomo6/backend/internal/textutil"
)

// Post-document validation and server-side derivation.
//
// The wall post document (content_json) is authored by the client, so the
// server must not trust it: this file is the single source of truth for which
// nodes/attributes are allowed, how large the document may be, which links are
// safe, and which derived columns (content/title/image_url/attachments) the
// server computes instead of accepting from the client.
//
// The schema mirrors the client's mediaSchema (v2): inline mediaBlock nodes
// referencing an attachment pool.

const (
	maxDocumentBytes = 200 * 1024
	maxDocumentNodes = 400
	maxDocumentDepth = 12
	maxContentRunes  = 4000
	maxCaptionRunes  = 300
	maxTitleRunes    = 80
)

var allowedNodeTypes = map[string]bool{
	"doc":            true,
	"paragraph":      true,
	"text":           true,
	"hardBreak":      true,
	"customEmoji":    true,
	"mention":        true,
	"mediaBlock":     true,
	"mediaGroup":     true,
	"horizontalRule": true,
	"linkCard":       true,
	"spoilerBlock":   true,
}

var allowedMarkTypes = map[string]bool{
	"bold":      true,
	"italic":    true,
	"underline": true,
	"strike":    true,
	"link":      true,
	"textStyle": true,
	"spoiler":   true,
	"hashtag":   true,
}

var allowedMediaKinds = map[string]bool{"image": true, "video": true, "audio": true, "file": true}
var allowedMediaAligns = map[string]bool{"inline": true, "left": true, "right": true, "full": true}

// safeHref allows only schemes that cannot execute script.
func safeHref(raw string) bool {
	v := strings.ToLower(strings.TrimSpace(raw))
	return strings.HasPrefix(v, "http://") ||
		strings.HasPrefix(v, "https://") ||
		strings.HasPrefix(v, "mailto:") ||
		strings.HasPrefix(v, "tel:")
}

// contentJSONMap normalizes the content_json value (object, JSON string or
// nil). Returns nil for a legacy plain-text post with no document.
func contentJSONMap(value interface{}) map[string]interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if !strings.HasPrefix(trimmed, "{") {
			return nil
		}
		var doc map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &doc); err != nil {
			return nil
		}
		return doc
	default:
		return nil
	}
}

// attachmentsSlice normalizes the attachments value (array or JSON string).
func attachmentsSlice(value interface{}) []interface{} {
	switch typed := value.(type) {
	case []interface{}:
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if !strings.HasPrefix(trimmed, "[") {
			return nil
		}
		var list []interface{}
		if err := json.Unmarshal([]byte(trimmed), &list); err != nil {
			return nil
		}
		return list
	default:
		return nil
	}
}

// ValidatePostDocument returns a list of problems with the document. Empty
// means the document is valid. It never mutates the input. A non-doc
// content_json (legacy/opaque) is treated as valid and skipped — there is
// nothing to validate and no media references to smuggle.
func ValidatePostDocument(doc map[string]interface{}) []string {
	var problems []string
	if doc == nil {
		return nil
	}
	if nodeType, _ := doc["type"].(string); nodeType != "doc" {
		return nil
	}
	if raw, err := json.Marshal(doc); err != nil {
		return []string{"content_json is not serializable"}
	} else if len(raw) > maxDocumentBytes {
		problems = append(problems, fmt.Sprintf("content_json is too large (%d bytes)", len(raw)))
	}
	if version, ok := doc["schema_version"]; ok {
		number, isNumber := toFloat(version)
		if !isNumber || number > 2 {
			problems = append(problems, "unsupported content_json schema_version")
		}
	}
	count := 0
	walkDocument(doc, 1, &count, &problems)
	if count > maxDocumentNodes {
		problems = append(problems, fmt.Sprintf("content_json has too many nodes (%d)", count))
	}
	return problems
}

func walkDocument(node map[string]interface{}, depth int, count *int, problems *[]string) {
	*count++
	if depth > maxDocumentDepth {
		*problems = append(*problems, "content_json is nested too deeply")
		return
	}
	nodeType, _ := node["type"].(string)
	if !allowedNodeTypes[nodeType] {
		*problems = append(*problems, "unknown content_json node type: "+nodeType)
		return
	}
	switch nodeType {
	case "text":
		validateMarks(node, problems)
	case "mediaBlock":
		validateMediaNode(node, problems)
	case "linkCard":
		validateLinkCardNode(node, problems)
	case "spoilerBlock":
		validateSpoilerBlockNode(node, problems)
	}
	content, ok := node["content"].([]interface{})
	if !ok {
		return
	}
	for _, child := range content {
		if childMap, ok := child.(map[string]interface{}); ok {
			walkDocument(childMap, depth+1, count, problems)
		}
	}
}

func validateMarks(node map[string]interface{}, problems *[]string) {
	marks, ok := node["marks"].([]interface{})
	if !ok {
		return
	}
	for _, rawMark := range marks {
		mark, ok := rawMark.(map[string]interface{})
		if !ok {
			continue
		}
		markType, _ := mark["type"].(string)
		if !allowedMarkTypes[markType] {
			*problems = append(*problems, "unknown content_json mark type: "+markType)
			continue
		}
		if markType != "link" {
			continue
		}
		attrs, _ := mark["attrs"].(map[string]interface{})
		href, _ := attrs["href"].(string)
		if !safeHref(href) {
			*problems = append(*problems, "link mark with an unsafe href")
		}
	}
}

func validateMediaNode(node map[string]interface{}, problems *[]string) {
	attrs, _ := node["attrs"].(map[string]interface{})
	if attrs == nil {
		*problems = append(*problems, "mediaBlock without attributes")
		return
	}
	attachmentID, _ := attrs["attachmentId"].(string)
	if strings.TrimSpace(attachmentID) == "" {
		*problems = append(*problems, "mediaBlock without attachmentId")
	}
	if kind, ok := attrs["kind"].(string); ok && kind != "" && !allowedMediaKinds[kind] {
		*problems = append(*problems, "mediaBlock with an unknown kind")
	}
	if width, ok := attrs["width"]; ok {
		number, isNumber := toFloat(width)
		if !isNumber || number < 10 || number > 100 {
			*problems = append(*problems, "mediaBlock width out of range")
		}
	}
	if align, ok := attrs["align"].(string); ok && align != "" && !allowedMediaAligns[align] {
		*problems = append(*problems, "mediaBlock with an unknown align")
	}
	if href, ok := attrs["href"].(string); ok && !safeHref(href) {
		*problems = append(*problems, "mediaBlock with an unsafe href")
	}
	for _, key := range []string{"caption", "alt"} {
		if value, ok := attrs[key].(string); ok && utf8RuneLen(value) > maxCaptionRunes {
			*problems = append(*problems, "mediaBlock "+key+" is too long")
		}
	}
}

// validateLinkCardNode checks a link card's URL and text fields.
func validateLinkCardNode(node map[string]interface{}, problems *[]string) {
	attrs, _ := node["attrs"].(map[string]interface{})
	if attrs == nil {
		*problems = append(*problems, "linkCard without attributes")
		return
	}
	rawURL, _ := attrs["url"].(string)
	lower := strings.ToLower(strings.TrimSpace(rawURL))
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		*problems = append(*problems, "linkCard with an unsafe url")
	}
	if image, ok := attrs["image"].(string); ok && image != "" && !safeHref(image) {
		*problems = append(*problems, "linkCard with an unsafe image url")
	}
	for _, key := range []string{"title", "description", "siteName"} {
		if value, ok := attrs[key].(string); ok && utf8RuneLen(value) > maxCaptionRunes {
			*problems = append(*problems, "linkCard "+key+" is too long")
		}
	}
}

// validateSpoilerBlockNode checks a spoiler block's label length. The block may
// hold any allowed block content (text, media, galleries), which the generic
// walk already validates.
func validateSpoilerBlockNode(node map[string]interface{}, problems *[]string) {
	attrs, _ := node["attrs"].(map[string]interface{})
	if attrs == nil {
		return
	}
	if value, ok := attrs["label"].(string); ok && utf8RuneLen(value) > maxCaptionRunes {
		*problems = append(*problems, "spoilerBlock label is too long")
	}
}

// collectAttachmentRefs returns the attachmentId of every mediaBlock in order.
func CollectAttachmentRefs(node map[string]interface{}) []string {
	var refs []string
	var walk func(map[string]interface{})
	walk = func(current map[string]interface{}) {
		if nodeType, _ := current["type"].(string); nodeType == "mediaBlock" {
			if attrs, ok := current["attrs"].(map[string]interface{}); ok {
				if id, ok := attrs["attachmentId"].(string); ok && id != "" {
					refs = append(refs, id)
				}
			}
		}
		content, _ := current["content"].([]interface{})
		for _, child := range content {
			if childMap, ok := child.(map[string]interface{}); ok {
				walk(childMap)
			}
		}
	}
	walk(node)
	return refs
}

// referencedAttachmentIDs returns the set of ids the document actually uses.
func referencedAttachmentIDs(doc map[string]interface{}) map[string]bool {
	refs := CollectAttachmentRefs(doc)
	if len(refs) == 0 {
		return nil
	}
	set := make(map[string]bool, len(refs))
	for _, ref := range refs {
		set[ref] = true
	}
	return set
}

// ValidateAttachmentRefs checks that every attachmentId referenced by the
// document exists in the pool with a url. Legacy pools that the document does
// not reference (no ids at all) are ignored — only referenced entries matter.
func ValidateAttachmentRefs(doc map[string]interface{}, attachments []interface{}) []string {
	refs := referencedAttachmentIDs(doc)
	if refs == nil {
		return nil
	}
	var problems []string
	pool := map[string]map[string]interface{}{}
	for _, raw := range attachments {
		attachment, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := attachment["id"].(string)
		if id == "" {
			continue
		}
		pool[id] = attachment
	}
	for ref := range refs {
		entry, ok := pool[ref]
		if !ok {
			problems = append(problems, "mediaBlock references an attachment that is not in the pool")
			continue
		}
		if url, _ := entry["url"].(string); strings.TrimSpace(url) == "" {
			problems = append(problems, "referenced attachment has no url")
		}
	}
	return problems
}

// ValidateAttachmentsOwnership checks that every attachment the document
// references belongs to the post author: the storage path for the private wall
// bucket is /storage/v1/object/wall/<authorID>/<key>. Unreferenced legacy
// attachments are not checked.
func ValidateAttachmentsOwnership(doc map[string]interface{}, attachments []interface{}, authorID string) []string {
	if authorID == "" {
		return nil
	}
	refs := referencedAttachmentIDs(doc)
	if refs == nil {
		return nil
	}
	needle := "/wall/" + authorID + "/"
	var problems []string
	for _, raw := range attachments {
		attachment, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := attachment["id"].(string)
		if id == "" || !refs[id] {
			continue
		}
		url, _ := attachment["url"].(string)
		if url == "" {
			continue
		}
		if !strings.Contains(url, needle) {
			problems = append(problems, fmt.Sprintf("attachment %s is not owned by the author", id))
		}
	}
	return problems
}

// DerivePostFields computes the legacy/derived columns from the document.
// When the document references attachments it also returns the used subset;
// otherwise used is nil and the caller keeps the provided pool (legacy posts).
func DerivePostFields(
	doc map[string]interface{},
	attachments []interface{},
) (content string, title string, imageURL *string, used []interface{}) {
	text := collapsePlainText(documentPlainText(doc))
	content = textutil.TruncateRunes(text, maxContentRunes)
	if text == "" {
		title = "Пост на стене"
	} else {
		title = textutil.TruncateRunes(text, maxTitleRunes)
	}

	refs := CollectAttachmentRefs(doc)
	if len(refs) == 0 {
		return content, title, nil, nil
	}
	refSet := map[string]bool{}
	for _, ref := range refs {
		refSet[ref] = true
	}
	used = []interface{}{}
	for _, raw := range attachments {
		attachment, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := attachment["id"].(string)
		if id == "" || !refSet[id] {
			continue
		}
		used = append(used, attachment)
		if imageURL == nil {
			if kind, _ := attachment["type"].(string); kind == "image" {
				if url, _ := attachment["url"].(string); url != "" {
					value := url
					imageURL = &value
				}
			}
		}
	}
	return content, title, imageURL, used
}

// documentPlainText mirrors the client's prosemirrorToPlainText walk.
func documentPlainText(node map[string]interface{}) string {
	nodeType, _ := node["type"].(string)
	switch nodeType {
	case "text":
		text, _ := node["text"].(string)
		return text
	case "hardBreak":
		return "\n"
	case "customEmoji":
		return "\uFFFC"
	case "mention":
		if attrs, ok := node["attrs"].(map[string]interface{}); ok {
			if label, ok := attrs["label"].(string); ok && label != "" {
				return "@" + label
			}
			if id, ok := attrs["id"].(string); ok {
				return "@" + id
			}
		}
		return ""
	case "mediaBlock", "mediaGroup", "uploadPlaceholder":
		return ""
	case "linkCard":
		if attrs, ok := node["attrs"].(map[string]interface{}); ok {
			if url, ok := attrs["url"].(string); ok && url != "" {
				return " " + url + " "
			}
		}
		return " "
	case "spoilerBlock":
		var spoiler strings.Builder
		if attrs, ok := node["attrs"].(map[string]interface{}); ok {
			if label, ok := attrs["label"].(string); ok && strings.TrimSpace(label) != "" {
				spoiler.WriteString(strings.TrimSpace(label))
				spoiler.WriteString("\n")
			}
		}
		content, _ := node["content"].([]interface{})
		for _, child := range content {
			if childMap, ok := child.(map[string]interface{}); ok {
				spoiler.WriteString(documentPlainText(childMap))
			}
		}
		return spoiler.String()
	}
	var builder strings.Builder
	content, _ := node["content"].([]interface{})
	for _, child := range content {
		if childMap, ok := child.(map[string]interface{}); ok {
			builder.WriteString(documentPlainText(childMap))
		}
	}
	if nodeType == "paragraph" {
		builder.WriteString("\n")
	}
	return builder.String()
}

func collapsePlainText(text string) string {
	text = strings.ReplaceAll(text, "\u200b", "")
	for strings.Contains(text, "\n\n\n") {
		text = strings.ReplaceAll(text, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(text)
}

func toFloat(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	default:
		return 0, false
	}
}

func utf8RuneLen(value string) int {
	return len([]rune(value))
}
