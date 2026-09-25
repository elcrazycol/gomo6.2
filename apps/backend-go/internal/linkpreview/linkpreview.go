// Package linkpreview fetches OpenGraph/Twitter-card metadata for a URL so the
// frontend can render a link card. It is deliberately conservative: only
// http/https, a custom dialer that refuses private/loopback/link-local
// addresses (SSRF), capped redirects, timeouts, and a body size limit.
package linkpreview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/net/html"
)

const (
	maxBodyBytes    = 512 * 1024
	fetchTimeout    = 8 * time.Second
	dialTimeout     = 5 * time.Second
	maxRedirects    = 3
	cacheTTL        = 6 * time.Hour
	cacheKeyPrefix  = "linkpreview:"
	maxTitleRunes   = 200
	maxDescRunes    = 400
	maxSiteRunes    = 100
	userAgentString = "gomo6-link-preview/1.0 (+https://gomo6.wtf)"
)

// Preview is the normalized metadata for a link.
type Preview struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	SiteName    string `json:"site_name"`
}

// Fetcher retrieves and caches link previews.
type Fetcher struct {
	client *http.Client
	redis  *redis.Client
}

// New builds a Fetcher. redis may be nil (no caching).
func New(redisClient *redis.Client) *Fetcher {
	client := &http.Client{
		Timeout: fetchTimeout,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           safeDialContext,
			TLSHandshakeTimeout:   dialTimeout,
			ResponseHeaderTimeout: fetchTimeout,
			MaxIdleConns:          4,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("too many redirects")
			}
			return validateURL(req.URL)
		},
	}
	return &Fetcher{client: client, redis: redisClient}
}

// Fetch returns the preview for rawURL, using the cache when available.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (*Preview, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, errors.New("invalid url")
	}
	if err := validateURL(parsed); err != nil {
		return nil, err
	}

	cacheKey := cacheKeyPrefix + parsed.String()
	if f.redis != nil {
		if cached, err := f.redis.Get(ctx, cacheKey).Bytes(); err == nil {
			var preview Preview
			if json.Unmarshal(cached, &preview) == nil {
				return &preview, nil
			}
		}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", userAgentString)
	request.Header.Set("Accept", "text/html,application/xhtml+xml")

	response, err := f.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("unexpected status %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" && !strings.Contains(strings.ToLower(contentType), "html") {
		return nil, errors.New("not an html page")
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxBodyBytes))
	if err != nil {
		return nil, err
	}

	preview := Parse(string(body), response.Request.URL)
	if preview.Title == "" && preview.Description == "" && preview.Image == "" {
		return nil, errors.New("no preview metadata")
	}
	preview.URL = parsed.String()
	if f.redis != nil {
		if encoded, err := json.Marshal(preview); err == nil {
			f.redis.Set(ctx, cacheKey, encoded, cacheTTL)
		}
	}
	return preview, nil
}

func validateURL(parsed *url.URL) error {
	if parsed == nil {
		return errors.New("invalid url")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("only http/https urls are allowed")
	}
	if parsed.Host == "" {
		return errors.New("missing host")
	}
	return nil
}

// safeDialContext resolves the host and refuses to connect to private,
// loopback, link-local or otherwise internal addresses (SSRF), dialing the
// resolved IP directly to avoid DNS-rebinding between resolution and connect.
func safeDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(addresses) == 0 {
		return nil, errors.New("no address resolved")
	}
	var lastErr error
	for _, addr := range addresses {
		if isBlockedIP(addr.IP) {
			lastErr = fmt.Errorf("blocked address %s", addr.IP)
			continue
		}
		connection, err := (&net.Dialer{Timeout: dialTimeout}).DialContext(ctx, network, net.JoinHostPort(addr.IP.String(), port))
		if err == nil {
			return connection, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no allowed address")
	}
	return nil, lastErr
}

// isBlockedIP reports whether ip is inside a range a public link preview must
// never reach.
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		// Carrier-grade NAT 100.64.0.0/10.
		if ipv4[0] == 100 && ipv4[1] >= 64 && ipv4[1] <= 127 {
			return true
		}
		return false
	}
	// IPv6 unique local addresses fc00::/7.
	if len(ip) == net.IPv6len && (ip[0]&0xfe) == 0xfc {
		return true
	}
	return false
}

// Parse extracts OpenGraph/Twitter/title metadata from an HTML document.
// base resolves relative image URLs and is used as the site name fallback.
func Parse(document string, base *url.URL) *Preview {
	preview := &Preview{}
	root, err := html.Parse(strings.NewReader(document))
	if err != nil {
		return preview
	}

	var documentTitle string
	var ogTitle, ogDescription, ogImage, ogSiteName string
	var twitterTitle, twitterDescription, twitterImage string
	var metaDescription string

	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch node.Data {
			case "title":
				if documentTitle == "" {
					documentTitle = textContent(node)
				}
			case "meta":
				var property, name, content string
				for _, attribute := range node.Attr {
					switch strings.ToLower(attribute.Key) {
					case "property":
						property = strings.ToLower(strings.TrimSpace(attribute.Val))
					case "name":
						name = strings.ToLower(strings.TrimSpace(attribute.Val))
					case "content":
						content = attribute.Val
					}
				}
				key := property
				if key == "" {
					key = name
				}
				switch key {
				case "og:title":
					ogTitle = firstNonEmpty(ogTitle, content)
				case "og:description":
					ogDescription = firstNonEmpty(ogDescription, content)
				case "og:image", "og:image:url", "og:image:secure_url":
					ogImage = firstNonEmpty(ogImage, content)
				case "og:site_name":
					ogSiteName = firstNonEmpty(ogSiteName, content)
				case "twitter:title":
					twitterTitle = firstNonEmpty(twitterTitle, content)
				case "twitter:description":
					twitterDescription = firstNonEmpty(twitterDescription, content)
				case "twitter:image", "twitter:image:src":
					twitterImage = firstNonEmpty(twitterImage, content)
				case "description":
					metaDescription = firstNonEmpty(metaDescription, content)
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(root)

	preview.Title = truncateRunes(html.UnescapeString(strings.TrimSpace(firstNonEmpty(ogTitle, twitterTitle, documentTitle))), maxTitleRunes)
	preview.Description = truncateRunes(html.UnescapeString(strings.TrimSpace(firstNonEmpty(ogDescription, twitterDescription, metaDescription))), maxDescRunes)
	siteName := strings.TrimSpace(firstNonEmpty(ogSiteName, ""))
	if siteName == "" && base != nil {
		siteName = base.Host
	}
	preview.SiteName = truncateRunes(html.UnescapeString(siteName), maxSiteRunes)
	preview.Image = resolveImage(firstNonEmpty(ogImage, twitterImage), base)
	return preview
}

func resolveImage(raw string, base *url.URL) string {
	raw = strings.TrimSpace(html.UnescapeString(raw))
	if raw == "" || base == nil {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(parsed)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}

func textContent(node *html.Node) string {
	var builder strings.Builder
	var walk func(*html.Node)
	walk = func(current *html.Node) {
		if current.Type == html.TextNode {
			builder.WriteString(current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return builder.String()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}
