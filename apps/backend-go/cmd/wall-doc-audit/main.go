// Command wall-doc-audit scans every wall post's stored content_json and prints
// the problems the server-side document validator would reject in enforce mode.
//
// It is meant to run before flipping WALL_DOC_VALIDATION=enforce: review the
// output, fix/accept anything legitimate, then enforce.
//
// Usage:
//
//	DATABASE_URL=... wall-doc-audit [-limit N] [-quiet]
//
// Exit code is 1 when any invalid document was found (handy for CI / scripts).
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	_ "github.com/lib/pq"

	"github.com/gomo6/backend/internal/wall"
)

func main() {
	limit := flag.Int("limit", 0, "max posts to scan (0 = all)")
	quiet := flag.Bool("quiet", false, "print only the summary")
	flag.Parse()

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is not set")
		os.Exit(2)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open db: %v\n", err)
		os.Exit(2)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		fmt.Fprintf(os.Stderr, "ping db: %v\n", err)
		os.Exit(2)
	}

	query := `SELECT id, author_id, content_json, attachments
	          FROM profile_wall_posts
	          WHERE content_json IS NOT NULL
	          ORDER BY created_at`
	args := []interface{}{}
	if *limit > 0 {
		query += " LIMIT $1"
		args = append(args, *limit)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		fmt.Fprintf(os.Stderr, "query: %v\n", err)
		os.Exit(2)
	}
	defer rows.Close()

	var total, withDoc, invalid int
	problemCounts := map[string]int{}

	for rows.Next() {
		var id, authorID string
		var contentJSON, attachments []byte
		if err := rows.Scan(&id, &authorID, &contentJSON, &attachments); err != nil {
			fmt.Fprintf(os.Stderr, "scan: %v\n", err)
			os.Exit(2)
		}
		total++
		doc := decodeObject(contentJSON)
		if doc == nil {
			continue
		}
		withDoc++
		pool := decodeArray(attachments)

		problems := wall.ValidatePostDocument(doc)
		problems = append(problems, wall.ValidateAttachmentRefs(doc, pool)...)
		problems = append(problems, wall.ValidateAttachmentsOwnership(doc, pool, authorID)...)
		if len(problems) == 0 {
			continue
		}
		invalid++
		for _, problem := range problems {
			problemCounts[problem]++
		}
		if !*quiet {
			fmt.Printf("✗ %s (author %s)\n", id, authorID)
			for _, problem := range problems {
				fmt.Printf("    - %s\n", problem)
			}
		}
	}
	if err := rows.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "rows: %v\n", err)
		os.Exit(2)
	}

	fmt.Printf("\nScanned %d posts with content_json, %d documents, %d invalid.\n", total, withDoc, invalid)
	if len(problemCounts) > 0 {
		fmt.Println("Problems by kind:")
		for kind, count := range problemCounts {
			fmt.Printf("  %4d  %s\n", count, kind)
		}
	}
	if invalid > 0 {
		os.Exit(1)
	}
}

func decodeObject(raw []byte) map[string]interface{} {
	if len(raw) == 0 {
		return nil
	}
	var value interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	// content_json is a JSONB object, but legacy rows may store a JSON string.
	if text, ok := value.(string); ok {
		var doc map[string]interface{}
		if err := json.Unmarshal([]byte(text), &doc); err != nil {
			return nil
		}
		return doc
	}
	doc, _ := value.(map[string]interface{})
	return doc
}

func decodeArray(raw []byte) []interface{} {
	if len(raw) == 0 {
		return nil
	}
	var value interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	if list, ok := value.([]interface{}); ok {
		return list
	}
	return nil
}
