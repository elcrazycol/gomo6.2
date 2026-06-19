import type { Thread, Post, Board, Profile, Message, Conversation, RawChatMessage } from "./index.js";

export interface BotEvents {
  ready: [];
  message: [MessageContext];
  post_created: [PostContext];
  thread_created: [Thread];
  like: [LikeEvent];
  unlike: [LikeEvent];
  wall_post: [Post];
  wall_post_edited: [Post];
  wall_post_deleted: [{ id: string; user_id: string }];
  chat_message: [MessageContext];
  message_edited: [{ id: string; content: string; conversation_id: string }];
  message_deleted: [{ id: string; conversation_id: string }];
  read_receipt: [{ message_id: string; user_id: string; conversation_id: string }];
  notification: [unknown];
  user_online: [{ user_id: string; username: string }];
  user_offline: [{ user_id: string; username: string }];
  typing: [{ user_id: string; username: string; room: string }];
  chat_typing: [{ user_id: string; username: string; is_typing: boolean; conversation_id: string }];
  error: [Error];
  reconnecting: [number];
  disconnected: [];
  connected: [{ user_id: string; username: string }];
}

export interface LikeEvent {
  thread_id?: string;
  post_id?: string;
  user_id: string;
}

export interface MessageContext {
  text: string;
  conversationId: string;
  senderId: string;
  messageId: string;
  isEdited: boolean;
  sentAt: Date;
  reply(content: string): Promise<Message>;
  edit(content: string): Promise<void>;
  delete(): Promise<void>;
}

export interface PostContext {
  text: string;
  threadId: string;
  postId: string;
  userId: string;
  reply(content: string): Promise<Post>;
}

import type { HttpClient } from "../client/httpClient.js";

export class MessageContextImpl implements MessageContext {
  constructor(
    private http: HttpClient,
    private raw: RawChatMessage,
  ) {}

  get text(): string { return this.raw.content; }
  get conversationId(): string { return this.raw.conversation_id; }
  get senderId(): string { return this.raw.sender_user_id; }
  get messageId(): string { return this.raw.id; }
  get isEdited(): boolean { return this.raw.is_edited; }
  get sentAt(): Date { return new Date(this.raw.sent_at); }

  async reply(content: string): Promise<Message> {
    return this.http.sendMessage(this.raw.conversation_id, content);
  }

  async edit(content: string): Promise<void> {
    return this.http.editMessage(this.raw.conversation_id, this.raw.id, content);
  }

  async delete(): Promise<void> {
    return this.http.deleteMessage(this.raw.conversation_id, this.raw.id);
  }
}

export class PostContextImpl implements PostContext {
  constructor(
    private http: HttpClient,
    private raw: Post,
  ) {}

  get text(): string { return this.raw.content; }
  get threadId(): string { return this.raw.thread_id; }
  get postId(): string { return this.raw.id; }
  get userId(): string { return this.raw.user_id; }

  async reply(content: string): Promise<Post> {
    return this.http.createPost({ thread_id: this.raw.thread_id, content });
  }
}
