package wall

import (
	"strings"
	"testing"
)

const authorID = "11111111-1111-1111-1111-111111111111"

func mediaBlock(attachmentID string, extra map[string]interface{}) map[string]interface{} {
	attrs := map[string]interface{}{
		"attachmentId": attachmentID,
		"kind":         "image",
		"width":        float64(60),
		"align":        "inline",
	}
	for key, value := range extra {
		attrs[key] = value
	}
	return map[string]interface{}{"type": "mediaBlock", "attrs": attrs}
}

func paragraph(children ...interface{}) map[string]interface{} {
	return map[string]interface{}{"type": "paragraph", "content": children}
}

func attachment(id, kind, url string) map[string]interface{} {
	return map[string]interface{}{"id": id, "type": kind, "url": url}
}

func wallURL(key string) string {
	return "/storage/v1/object/wall/" + authorID + "/" + key
}

func TestValidatePostDocumentAcceptsValidDocument(t *testing.T) {
	doc := map[string]interface{}{
		"type":           "doc",
		"schema_version": float64(2),
		"content": []interface{}{
			paragraph(wallText("привет", nil)),
			mediaBlock("att_1", nil),
		},
	}
	if problems := ValidatePostDocument(doc); len(problems) != 0 {
		t.Fatalf("expected no problems, got %v", problems)
	}
}

func TestValidatePostDocumentRejectsUnknownNode(t *testing.T) {
	doc := map[string]interface{}{
		"type":    "doc",
		"content": []interface{}{map[string]interface{}{"type": "script"}},
	}
	problems := ValidatePostDocument(doc)
	if len(problems) == 0 || !strings.Contains(strings.Join(problems, "; "), "unknown content_json node type") {
		t.Fatalf("expected unknown node problem, got %v", problems)
	}
}

func TestValidatePostDocumentRejectsUnsafeLinkMark(t *testing.T) {
	text := wallText("click", []interface{}{
		map[string]interface{}{"type": "link", "attrs": map[string]interface{}{"href": "javascript:alert(1)"}},
	})
	doc := map[string]interface{}{"type": "doc", "content": []interface{}{paragraph(text)}}
	if problems := ValidatePostDocument(doc); len(problems) == 0 {
		t.Fatal("expected unsafe link to be flagged")
	}
}

func TestValidatePostDocumentRejectsBadMediaAttrs(t *testing.T) {
	doc := map[string]interface{}{
		"type": "doc",
		"content": []interface{}{
			mediaBlock("att_1", map[string]interface{}{
				"width": float64(500),
				"href":  "javascript:alert(1)",
			}),
			mediaBlock("", nil),
		},
	}
	problems := strings.Join(ValidatePostDocument(doc), "; ")
	if !strings.Contains(problems, "width out of range") {
		t.Fatalf("expected width problem, got %q", problems)
	}
	if !strings.Contains(problems, "unsafe href") {
		t.Fatalf("expected href problem, got %q", problems)
	}
	if !strings.Contains(problems, "without attachmentId") {
		t.Fatalf("expected attachmentId problem, got %q", problems)
	}
}

func TestValidateAttachmentRefsAndOwnership(t *testing.T) {
	doc := map[string]interface{}{
		"type":    "doc",
		"content": []interface{}{mediaBlock("att_1", nil), mediaBlock("att_2", nil)},
	}
	pool := []interface{}{
		attachment("att_1", "image", wallURL("a.png")),
		attachment("att_2", "image", "/storage/v1/object/wall/other-user/b.png"),
	}
	refProblems := ValidateAttachmentRefs(doc, pool)
	if len(refProblems) != 0 {
		t.Fatalf("expected refs to be valid, got %v", refProblems)
	}

	ownership := ValidateAttachmentsOwnership(pool, authorID)
	if len(ownership) != 1 {
		t.Fatalf("expected exactly one ownership problem, got %v", ownership)
	}

	// A referenced id missing from the pool is flagged.
	missing := ValidateAttachmentRefs(doc, pool[:1])
	if len(missing) == 0 {
		t.Fatal("expected a missing-reference problem")
	}
}

func TestDerivePostFields(t *testing.T) {
	doc := map[string]interface{}{
		"type": "doc",
		"content": []interface{}{
			paragraph(wallText("Смотрите фото", nil)),
			mediaBlock("att_img", nil),
			mediaBlock("att_file", map[string]interface{}{"kind": "file"}),
		},
	}
	pool := []interface{}{
		attachment("att_img", "image", wallURL("img.png")),
		attachment("att_file", "file", wallURL("doc.pdf")),
		attachment("att_unused", "image", wallURL("unused.png")),
	}
	content, title, imageURL, used := DerivePostFields(doc, pool)
	if !strings.Contains(content, "Смотрите фото") {
		t.Fatalf("unexpected content %q", content)
	}
	if title != "Смотрите фото" {
		t.Fatalf("unexpected title %q", title)
	}
	if imageURL == nil || *imageURL != wallURL("img.png") {
		t.Fatalf("unexpected image_url %v", imageURL)
	}
	if len(used) != 2 {
		t.Fatalf("expected 2 used attachments, got %d", len(used))
	}
}

func TestDerivePostFieldsMediaOnly(t *testing.T) {
	doc := map[string]interface{}{"type": "doc", "content": []interface{}{mediaBlock("att_1", nil)}}
	content, title, _, used := DerivePostFields(doc, []interface{}{attachment("att_1", "image", wallURL("a.png"))})
	if content != "" {
		t.Fatalf("expected empty content for a media-only post, got %q", content)
	}
	if title != "Пост на стене" {
		t.Fatalf("unexpected title %q", title)
	}
	if len(used) != 1 {
		t.Fatalf("expected 1 used attachment, got %d", len(used))
	}
}

func TestContentJSONMapParsesString(t *testing.T) {
	if doc := contentJSONMap(`{"type":"doc","content":[]}`); doc == nil || doc["type"] != "doc" {
		t.Fatal("expected a parsed doc from a JSON string")
	}
	if doc := contentJSONMap("just text"); doc != nil {
		t.Fatal("expected nil for legacy plain text")
	}
}

func TestEqQueryID(t *testing.T) {
	if got := eqQueryID("eq.abc-123"); got != "abc-123" {
		t.Fatalf("unexpected id %q", got)
	}
	if got := eqQueryID("abc"); got != "" {
		t.Fatalf("expected empty for a non-eq filter, got %q", got)
	}
}

// wallText builds a text node with optional marks.
func wallText(value string, marks []interface{}) map[string]interface{} {
	node := map[string]interface{}{"type": "text", "text": value}
	if marks != nil {
		node["marks"] = marks
	}
	return node
}
