package handlers

import (
	"log"
	"time"
)

// MessengerLogger logs messenger events for monitoring and debugging
type MessengerLogger struct {
	enableDebug bool
}

// NewMessengerLogger creates a new messenger logger
func NewMessengerLogger(enableDebug bool) *MessengerLogger {
	return &MessengerLogger{
		enableDebug: enableDebug,
	}
}

// LogMessageSent logs when a message is sent
func (l *MessengerLogger) LogMessageSent(userID, conversationID, messageID string) {
	log.Printf("[Messenger] Message sent: user=%s conversation=%s message=%s", userID, conversationID, messageID)
}

// LogMessageDelivered logs when a message is delivered
func (l *MessengerLogger) LogMessageDelivered(userID, conversationID, messageID string) {
	if l.enableDebug {
		log.Printf("[Messenger] Message delivered: user=%s conversation=%s message=%s", userID, conversationID, messageID)
	}
}

// LogMessageRead logs when a message is read
func (l *MessengerLogger) LogMessageRead(userID, conversationID, messageID string) {
	if l.enableDebug {
		log.Printf("[Messenger] Message read: user=%s conversation=%s message=%s", userID, conversationID, messageID)
	}
}

// LogConversationCreated logs when a conversation is created
func (l *MessengerLogger) LogConversationCreated(userID, targetUserID, conversationID string) {
	log.Printf("[Messenger] Conversation created: initiator=%s target=%s conversation=%s", userID, targetUserID, conversationID)
}

// LogAccessDenied logs when access is denied
func (l *MessengerLogger) LogAccessDenied(userID, resource, reason string) {
	log.Printf("[Messenger] Access denied: user=%s resource=%s reason=%s", userID, resource, reason)
}

// LogRateLimitExceeded logs when rate limit is exceeded
func (l *MessengerLogger) LogRateLimitExceeded(userID, operation string) {
	log.Printf("[Messenger] Rate limit exceeded: user=%s operation=%s", userID, operation)
}

// LogValidationError logs validation errors
func (l *MessengerLogger) LogValidationError(userID, field, error string) {
	log.Printf("[Messenger] Validation error: user=%s field=%s error=%s", userID, field, error)
}

// LogError logs general errors
func (l *MessengerLogger) LogError(operation, error string) {
	log.Printf("[Messenger] Error: operation=%s error=%s", operation, error)
}

// MessengerMetrics tracks messenger metrics
type MessengerMetrics struct {
	messagesSent      int64
	messagesDelivered int64
	messagesRead      int64
	conversationsCreated int64
	accessDenied      int64
	rateLimitExceeded int64
	validationErrors  int64
	errors            int64
	lastReset         time.Time
}

// NewMessengerMetrics creates a new metrics tracker
func NewMessengerMetrics() *MessengerMetrics {
	return &MessengerMetrics{
		lastReset: time.Now(),
	}
}

// IncrementMessagesSent increments messages sent counter
func (m *MessengerMetrics) IncrementMessagesSent() {
	m.messagesSent++
}

// IncrementMessagesDelivered increments messages delivered counter
func (m *MessengerMetrics) IncrementMessagesDelivered() {
	m.messagesDelivered++
}

// IncrementMessagesRead increments messages read counter
func (m *MessengerMetrics) IncrementMessagesRead() {
	m.messagesRead++
}

// IncrementConversationsCreated increments conversations created counter
func (m *MessengerMetrics) IncrementConversationsCreated() {
	m.conversationsCreated++
}

// IncrementAccessDenied increments access denied counter
func (m *MessengerMetrics) IncrementAccessDenied() {
	m.accessDenied++
}

// IncrementRateLimitExceeded increments rate limit exceeded counter
func (m *MessengerMetrics) IncrementRateLimitExceeded() {
	m.rateLimitExceeded++
}

// IncrementValidationErrors increments validation errors counter
func (m *MessengerMetrics) IncrementValidationErrors() {
	m.validationErrors++
}

// IncrementErrors increments errors counter
func (m *MessengerMetrics) IncrementErrors() {
	m.errors++
}

// GetMetrics returns current metrics
func (m *MessengerMetrics) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"messages_sent":          m.messagesSent,
		"messages_delivered":     m.messagesDelivered,
		"messages_read":          m.messagesRead,
		"conversations_created":  m.conversationsCreated,
		"access_denied":          m.accessDenied,
		"rate_limit_exceeded":    m.rateLimitExceeded,
		"validation_errors":      m.validationErrors,
		"errors":                 m.errors,
		"uptime_seconds":         time.Since(m.lastReset).Seconds(),
	}
}

// Reset resets all metrics
func (m *MessengerMetrics) Reset() {
	m.messagesSent = 0
	m.messagesDelivered = 0
	m.messagesRead = 0
	m.conversationsCreated = 0
	m.accessDenied = 0
	m.rateLimitExceeded = 0
	m.validationErrors = 0
	m.errors = 0
	m.lastReset = time.Now()
}

// LogMetrics logs current metrics
func (m *MessengerMetrics) LogMetrics() {
	metrics := m.GetMetrics()
	log.Printf("[Messenger Metrics] %+v", metrics)
}
