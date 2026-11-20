# Messenger chat scrolling

**Status:** implemented (2026-10-18) on `refactor/messenger-telegram-scroll`.
Supersedes [native DOM slicing](./MESSENGER_VIRTUAL_SCROLL_PLAN.md) and, before
it, the TanStack-virtualizer approach
([plan](./MESSENGER_VIRTUAL_SCROLL_PLAN.md)).

The reference implementation is **Telegram Web** —
[github.com/Ajaxy/telegram-tt](https://github.com/Ajaxy/telegram-tt). Every rule
below is a port of something that client has tuned on real devices for years; the
comments in the code name the file it came from. Where gomo6 differs, the
difference is stated (`gomo6:` paragraphs) — the differences are real, not
simplifications.

---

## 1. The model in one paragraph

The browser owns the scroll. Rows are plain, normal-flow elements in one
`overflow-y: auto` box; no spacer, no absolutely positioned row, no transform, no
virtualizer. What the list owns is (a) **which slice of the history is mounted**
(a bounded window that slides like a page of a book), (b) **one** decision per
commit about where the scroll position should be, and (c) a **capability gate**
that decides when it is safe to change the DOM under the reader. Nothing else.

Two consequences do the actual work:

* **Nothing writes `scrollTop` while the reader is scrolling.** Every position
  change happens in a commit — the only moment the DOM changes anyway.
* **The engine's own scroll anchoring absorbs what the list cannot.** On
  Chromium/Firefox, content mounted *above* the viewport moves the reader's
  content by zero pixels, for free, on the compositor's terms. The list
  compensates only where that does not happen (WebKit).

## 2. Files

```
components/messenger/MessageList.tsx        the list: one writer, triggers, gate
components/messenger/core/fasterdom.ts      batched read/write pass (1 frame)
components/messenger/core/animateScroll.ts  the bounded, cancellable glide
components/messenger/core/scrollGeometry.ts position primitives (+ bottom sentinel)
components/messenger/core/slicing.ts        keyed mounted-window math (pure)
components/messenger/core/messageScrollAnchors.ts  session anchor per conversation
lib/scrollAnchoring.ts                      behavioural anchoring detection
```

Porting map, for anything that needs re-deriving later:

| gomo6 | telegram-tt |
|---|---|
| `core/fasterdom.ts` | `lib/fasterdom/fasterdom.ts` (+ `stricterdom.ts` phases) |
| `core/animateScroll.ts` | `util/animateScroll.ts` |
| `core/scrollGeometry.ts` | `components/middle/helpers/messageListReserves.ts` (constants, sentinel, snapping) |
| `core/slicing.ts` | `getViewportSlice` / `MESSAGE_LIST_VIEWPORT_LIMIT` in `global/actions/api/messages.ts` |
| the writer in `MessageList.tsx` | `useLayoutEffectWithPrevDeps` in `components/middle/MessageList.tsx` |
| trigger sentinels | `useScrollHooks` + `MessageListContent.tsx` (`backwards-trigger` / `forwards-trigger`) |
| read line | `useMessageObservers` (`markMessageListRead({ maxId })`) |

## 3. One writer

`MessageList.tsx` has exactly one `useLayoutEffect` that decides the position,
and it runs inside `requestForcedReflow` so the geometry it reads and the write
it returns never interleave with another task's reads or writes. Its decision
tree, in order:

1. **First placement** — the restored session anchor, else the newest row.
2. **A pending jump** — `centerOrTop` (centre a target that fits the viewport,
   align a taller one to the top — Telegram's default for a focus) with a 20px
   margin, then flash it.
3. **A new tail while following** — glide the arrival into view (the "message
   rises" feel), capped at the default 800px. The glide target is the zero-height
   trigger *after* the content, so it lands on the real bottom, not one sentinel
   above it.
4. **An explicit "to the newest message"** (the FAB) — Telegram Web's
   scroll-to-bottom button: the distance the reader cannot see is *cut*, and the
   last ≤500px glides down (`maxDistance: 500, forceDirection: 'down'`). Gliding
   through thousands of pixels reads as a hang; a jump with no glide at all reads
   as a teleport. This is the middle ground the reference client settled on.
5. **The reader was at the bottom** — pin with the sentinel
   (`scrollTop = 1e7`, which the engine clamps to the new maximum). This single
   write keeps a growing list glued, whatever grew and on which side.
6. **Otherwise** — compensate the layout change above the reader's anchor, plus
   any movement of the scroller's own top edge (the pinned banner appearing above
   the messages pushes the content down; the composer growing below does not).

"Was the reader at the bottom" is derived, never stored:

```ts
// `scrollHeight - scrollTop` grew by exactly what was added BELOW while the
// reader did not move, so comparing it against the PREVIOUS viewport height
// judges the position as it was before this commit.
const wasAtBottom = (scrollHeight - scrollTop) - previousClientHeight <= 4;
```

A stored `scrollTop` would go stale the moment the reader scrolls between two
commits; this formula cannot, because it is re-derived from the live geometry.

### 3.1 The anchor invariant

The anchor is a mounted row — **one row below the fold**, deliberately
(Telegram anchors on `preservedItemElements[1]`). Its *scroll coordinate* is
`rect.top - scrollerRect.top + scrollTop`, which is **invariant under scrolling**:
the reader scrolling changes `rect.top` and `scrollTop` by exactly the same
amount. So the delta that coordinate moved by between two commits is *exactly*
the layout change above the reader's place:

```ts
const growth = anchorCoordNow - anchorCoordBefore;   // the real inserted height
```

What to do with it depends on the engine, and this is the subtle part:

* **Chromium/Firefox already did it.** Scroll anchoring keeps the anchor's
  `rect.top` where it was and moves `scrollTop` by the inserted height instead —
  so `growth` measures the insertion but the position is already correct, and any
  write would throw the reader a *second* full growth down the list. There the
  list writes nothing (`contentCompensation = 0`).
* **WebKit did nothing**, so the same delta is the compensation:
  `scrollTop += growth`.

Writing `scrollTop += growth` unconditionally is therefore a *double*
compensation on the anchoring engines — a jump of exactly the inserted height on
every page mount, which is precisely the bug this section's first version had
(measured by the dev counters below: two writes per mount gesture; after the fix,
zero — see §8).

A container whose **top edge** moved (the pinned banner appearing above the
messages) is never the engine's business, so that part of the correction is
always applied.

One row below the fold rather than the first visible row, because the first row
can change height when older messages are mounted (a date separator moves to an
older message, a grouped bubble loses its header) — the reader must not be
compensated for a change inside the row they are looking at.

gomo6: unlike Telegram, the date separator is rendered *inside* a `.message-item`
(`ChatView.renderMessage` → `dateLabel`). That is why the one-row offset is
required here and merely advisable there.

### 3.2 The one exception: chrome size changes

A scroller's own box can change with no message changing and no commit in the
list at all: the pinned banner appears above the messages (moving the top edge
down), the composer grows a line, the mobile keyboard opens, the window is
resized. The browser keeps `scrollTop` through all of those, which moves the
reader.

`syncChrome` (a `ResizeObserver` on the scroller) is the only second writer. It
uses the same derivation as the commit path — "was the reader glued?" from the
last commit's `bottomOffset` and viewport height — then either pins (glued) or
subtracts the top-edge delta (not glued), and records what it did in
`prevCommitRef` so the next commit's arithmetic stays coherent. Telegram Web
splits the same way: the panes/player hooks compensate the top reserve
(`updateTopReserveWithScrollCompensation`).

## 4. "At the bottom" is native

While the reader is within a band around the bottom trigger the scroller is a
snap container (`with-bottom-snap`) and the zero-height `.fab-trigger` after the
content is its snap point:

```css
.message-scroll.with-bottom-snap { scroll-snap-type: y proximity; }
.message-list .fab-trigger { height: 0; scroll-snap-align: end; }
```

The class is armed and disarmed from the position (`syncBottomSnap`), so snapping
can never pull a reader who has left the band back down. `animateScroll` holds
snapping off through `scroll-snap-type: none` while a glide owns the position.

Why this matters: a list whose bottom edge grows no longer needs a JS write to
stay pinned. The scroll-snap position is honoured by the browser during layout,
which is precisely what a `scrollTop` write during a live scroll is not (WebKit
drops those).

### 4.1 Remembering the place across a reload

`core/messageScrollAnchors.ts` keeps `{ key, offset }` per conversation: written at
every verified rest (only while the reader is away from the bottom, and cleared
there), and persisted to `sessionStorage` so a reloaded tab — or a relaunched PWA
— reopens where the reader was. Telegram Web does the same with its persisted
scroll offset and saved viewport. Session storage rather than local: two tabs on
different messages of one chat must not fight over a single entry.

`MessageList` already seeded its window from that anchor; persistence turns the
"return to the chat" behaviour into a "return to the app" one.

## 5. The mounted window

Bounded in `core/slicing.ts`, expressed in **keys** (`messageKey` = `client_id ||
id`), so a prepend, an optimistic → server swap or an index shift never
re-anchors the reader to a different message:

* mounted on open: `INITIAL_WINDOW` (80);
* each slide step: `WINDOW_STEP` (50) rows, in the direction the reader is moving;
* hard ceiling: `MAX_DOM_MESSAGES` (180) — rows on the far side are dropped, and
  the far side is off screen by construction;
* a window that follows the tail (`last: null`) never drops from the bottom: it
  owns the newest rows.

`last: null` means "follow the tail"; the key is *not* derived from "the window
ends at the array end" — confusing those two was a real bug (a frozen window
would silently become a follower and stop trimming). Use
`enlargeWindow`/`flushBufferedPage` in `MessageList.tsx` for the two transitions;
everything else goes through `resolveKeyWindow`.

**No `content-visibility` on messenger rows.** A row the engine has not laid out
contributes an estimate; replacing the estimate with the real height moves
everything below it. Chromium/Firefox absorb that with scroll anchoring, WebKit
cannot — that is the per-message stutter documented in §7.1. The mounted window
is what bounds the cost instead, and it is sized like Telegram's (40 rows on a
phone, 60 on a desktop, viewport limit 120) rather than generously: a row that is
mounted costs layout on every commit that touches it. GomoSub's `ChannelChat` (document-scrolled,
much larger window) keeps `content-visibility`, gated on the behavioural flag.

### 5.1 The dev counters

`core/scrollDiagnostics.ts` + `ScrollDebugOverlay.tsx` exist so this document does
not have to be taken on faith. Enable in a dev build:

```
http://localhost:8081/messages?scrolldebug=1
# or, in the console: localStorage.setItem("gomo6:scrolldebug", "1") + reload
```

The headline row is **"записей scrollTop за прокрутку"** — writes between the
first scroll event and the verified rest. It must read 0 through any scrolling,
fling or momentum; a non-zero value is the bug, and the note names the writer
(`pin`, `anchor`, `glide`, `chrome:pin`, `chrome:top`). The panel also reports the
rows mounted/dropped per gesture, the mounted window size, commit duration
(last / max), long frames, history requests and rest passes.

A gesture means *the reader is scrolling the content*. A tap is not one, so
pressing the "to the newest message" button shows **0** here while `записей
всего` grows: the jump (cut to 500px, then glide) is deliberate navigation, not a
scroll. The one legitimate non-zero case is `chrome:*` — Safari's collapsing
toolbar resizes the scroller mid-scroll and keeping the reader's place costs one
write; the note says so.

The whole overlay is dev-only: `import.meta.env.DEV` folds to `false`, so the
dynamic import is dropped from a production build entirely (verified: the
overlay's strings are absent from `dist/assets/*.js`). The counter module itself
ships as a no-op — every function returns immediately unless the flag was read as
`1` at boot, so the cost in a normal session is one boolean test per event.

## 6. Triggers, reads and the capability gate

**History triggers.** Two 1px sentinels with `rootMargin: 750px` *request* work
only; the mount itself happens in a commit. `prefetchOlder()` additionally
requests the next page from the per-frame scroll pass as soon as the position is
within `PREFETCH_PX` (12000) of the top: a request touches no DOM, so it is safe
mid-fling and it takes the network round trip out of the wait when the reader
arrives at the mounted top. The store's buffered page (`postpone: true` in
`loadMoreMessages`, up to two pages) is what makes request early / insert late
possible. On a phone a row is ~50–90px, so 12000px is several pages of runway —
enough that a fast fling does not outrun the network.

**Our own write is not the reader.** Every `scrollTop` write produces a scroll
event, and on WebKit every "the reader is scrolling" decision (arming the rest,
deferring a mount, refreshing the snap state) costs a rest window. The writer
therefore marks its writes (`justWrotePositionRef`, Telegram Web's
`isScrollTopJustUpdatedRef`) and the scroll handler drops that one event. Without
it, a mount's own compensation echo re-arms the rest and the *next* page waits
another full rest — measured in the tests as a slide that never happens.

**A glide owns the position.** While `animateScroll` runs, its per-frame writes are
not the reader either: the scroll pass returns early, so a 500ms glide does not
drag four rest passes and four read-line searches behind it. And a commit that
lands *during* a glide (a message arrived, a share card resolved, a page was
mounted above) retargets it (`restartCurrentScrollAnimation`) instead of writing a
second, competing position — the glide still lands where it was aiming.

**A touch takes the position back.** Telegram cancels a glide when a new focus
supersedes it; a reader touching the list is the strongest version of that, so
`cancelScrollAnimation` runs on the gesture gate's pointer-down. Otherwise a
glide that is still running would keep writing under the reader's finger (dropped
on WebKit, then replayed as a jump when the finger lifts).

**Capability gate.** Adding rows above the viewport is free where the engine
anchors. Where it does not (WebKit), the compensating write would be dropped
under a live gesture and the added rows would shift the reader's content — so
those mounts wait for a **verified rest**: the scroller must be quiet for
`REST_MS` (80 — Telegram Web's debounce scale; the *verification* is what makes it
safe, not the timer) *and* its position must be the same as at the last
observation. A quiet event stream is not proof of a rest; the position is. That
one window is the entire "wall" the reader feels on iOS: the page is already
fetched and buffered, only the insert waits.

### 6.1 Why there is no invisible staging of the incoming page

Mounting the page into a zero-height, `content-visibility: hidden` container
during the fling and flipping its height at the rest looks attractive (the rest
path then costs one layout instead of a render plus a layout). It was considered
and rejected: the React commit and the element creation still happen *during the
gesture*, i.e. on the frame budget of the very scroll the reader is judging, and
a 10–20ms commit mid-fling is a dropped frame — the exact symptom this whole
engine exists to remove. The wall, by contrast, is a single beat *after* the
scroll has already stopped, and `REST_MS` is the only part of it under our
control. Telegram Web does not stage rows either; its answer to the same problem
is a deeper local cache and native anchoring (`§7.1b`).

The pointer gate is a gate on the *mount path*, never on the rest pass itself: a
finger held on the list keeps `pointerDownRef` true and defers upward mounts, and
the release arms the rest so the deferred work happens immediately.

**Stale triggers.** A programmatic position replace sets
`replacingHistoryRef` for the duration of the commit, and the history triggers do
nothing while it is set. Safari delivers `IntersectionObserver` entries between
the DOM mutation and the scroll restore; acting on one would mount a page for a
position that no longer exists (Telegram Web: `isReplacingHistoryRef`).

**Read line.** The newest message the reader has actually seen, found by binary
search over the mounted rows (`offsetTop` is monotonic in document order) at a
verified rest, and reported only when the answer changed. No row-by-row scan, no
IntersectionObserver per row. Two rules make it reach the end of a chat:

* **Intersection, not full visibility.** A message taller than the viewport is
  never "fully visible", so a read line built on that rule stops one message short
  of the newest one — and the chat stays unread however often the reader scrolls to
  the bottom. Telegram marks on intersection (`useMessageObservers` →
  `markMessageListRead({ maxId })`).
* **At the bottom, the newest message is the line — the reader's own included.**
  Filtering own messages out is the same trap from the other side: if the newest
  message is the reader's (which is what sending a message produces), the line can
  never advance past it, and both the local count and the server's stay put. The
  backend marks the whole *prefix* up to the reported message, so reporting one's
  own message is exactly the right thing to say.

A failed request is retried (3s, monotonic — a newer line subsumes the older one)
and the pending line is flushed on `pagehide` / `visibilitychange`, so a chat
cannot be left unread by a lost request or a closed tab.

**Following.** `FOLLOW_SLACK` (100px) decides whether the reader is "with" the
conversation: while following, the window follows the tail and arrivals glide in;
otherwise the window freezes (`last` materializes), the arrival is not mounted,
nothing moves and the badge counts it.

## 7. Device findings (keep these)

Carried over from the previous implementation; they are the reasons several rules
exist at all.

### 7.1 Why there is no `content-visibility` on messenger rows

Measured on a real iPhone, same conversation, same window, only the flag
differing:

| | `content-visibility` | row heights of the mounted window | `scrollHeight` |
|---|---|---|---|
| Chromium (anchoring) | `auto` | 64, 64, 64, … (skipped) | 3202 |
| Safari (no anchoring) | `visible` | 111, 89, 69, 69, 69 … (real) | 3161 |

A skipped row occupies `contain-intrinsic-size`. When it scrolls into view its
real height replaces the estimate, so everything below it moves by the
difference. Chromium/Firefox absorb that with native scroll anchoring; WebKit
has none, so the reader sees a small jump on *every* message while scrolling up
through rows that have not been rendered yet, and the underestimated
`scrollHeight` ends a momentum fling early. Once every row has been rendered the
jitter disappears — the classic "it only stutters until everything is loaded".

The capability is detected **behaviourally** (a probe scroller, see
`lib/scrollAnchoring.ts`) and published as `has-scroll-anchoring` on `<html>`
before the first paint. It must never be derived from
`CSS.supports("overflow-anchor", …)`: an engine may parse the property without
anchoring, which would put Safari on the broken branch.

### 7.1b What the reference client actually does about WebKit

Worth being straight about, because gomo6's gate is *stricter* than Telegram Web's:
telegram-tt has **no** "wait for a rest" rule in its message list. It does not
need one, because it never creates the situation the rule protects against:

* no `content-visibility` on message rows, so no estimate is ever replaced by a
  real height (the §7.1 stutter cannot start);
* every position write happens in a commit, and only when the state changed —
  there is no write on scroll to drop;
* the bottom is native scroll snapping, so a growing list needs no write at all;
* `isReplacingHistoryRef` ignores the stale Safari trigger entries that a
  programmatic replace produces, `isScrollTopJustUpdated` ignores the scroll event
  its own write produces;
* `fasterdom` batches reads and writes, so a commit costs one reflow, not one
  per row.

gomo6 keeps all of that and adds the rest gate on top, because unlike the
reference client it has real iOS-web users to protect and a WebKit that drops the
compensating write under a live gesture (measured — §7.2). The gate is the only
place this port is more conservative than the original; if it ever proves
unnecessary on a device, `canMountAboveNow` is where it is removed.

### 7.2 A quiet event stream is not a rest — and a finger is not a rest either

The mount/compensation path writes `scrollTop`, and WebKit drops such a write
while a gesture is live. Two guards, both required:

* **The position must be unchanged** since the last observation, or the rest pass
  re-arms itself. `scroll` events can go quiet before the momentum has visually
  ended (iOS), so the timer alone is not proof.
* **No pointer may be on the list.** A finger that is simply resting is still a
  live gesture: a mutation there moves the content under the finger (the reader
  ends up acting on a *different* message) and the deferred write lands later as
  a second, visible jump ("it teleports me twice"). The list tracks
  `pointerdown`…`pointerup` window-level, so a flick that ends off-screen still
  clears it, and defers every upward mount until the release — which also arms
  the rest.

### 7.3 Rolled back: the aggressive runway (2026-10-18)

An attempt to remove the "wall" grew the mounted window past the ceiling at every
stop, then trimmed it back — a lot of layout and position churn exactly when the
momentum ends, which reads as a jerk right after the scroll stops. What survived:
the pointer gate and the early request. The lesson is now structural: the window
slides by one-sided steps, so mounting never has to be compensated on the far
side, and the same step never both mounts and trims more than the overflow.

## 8. Verification

* Unit — `core/fasterdom.test.ts` (measure/mutate ordering, forced reflow, the
  hidden-tab fallback), `core/animateScroll.test.ts` (target math, the 800px
  cap, duration, snap hold/release, cancellation), `core/scrollGeometry.test.ts`
  (bottom-relative offset, the sentinel pin, clamping),
  `core/slicing.test.ts` (keyed window math).
* Integration — `MessageList.test.tsx`: opens pinned; bounded window in source
  order; no spacer/absolute placement; snap armed at the bottom and disarmed in
  history; FAB/badge; arrival pins while following; arrival freezes the window
  and counts while in history; prepends are not counted as unread; FAB returns to
  the newest rows; a slide into loaded rows above compensates exactly
  (`WINDOW_STEP * ROW`); mounts wait for a verified rest without anchoring and
  are immediate with it; a buffered page is mounted above the reader; the ceiling
  holds; session-anchor restore; glide + flash on jump; paging for an unloaded
  jump target; the read line (own/deleted skipped, fold-aware, deduped); the
  chrome writer (stays glued when the viewport shrinks, keeps the reader's place
  when the top edge moves).
  GomoSub's `ChannelChat.test.tsx` covers the document-scrolled variant of the
  same engine (its window, its anchor, its device table).
* Dev counters — `core/scrollDiagnostics.test.ts` (gesture accounting) and a
  `MessageList` case that scrolls a real list with the overlay on and asserts the
  per-gesture write count is 0.
* Measured in a browser on the seeded 200-message chat, over five gestures that
  mount a page and slide the window 50 → 100 → 150 → 180 rows: **0 writes per
  gesture, worst gesture 0**, commit 2.5 ms for a slide and ~17–20 ms for a mount
  of 100 rows (dev build, hidden tab). The same run before the anchoring fix
  reported 2 writes per mount gesture.
* Manual (a device is required, and is **not** a substitute for CI): open a
  long chat at the bottom, fling up through several pages, fling back down,
  receive a message while at the bottom and while deep in history, open a pinned
  message, send with the keyboard open, rotate. iOS Safari and Android Chrome are
  the two targets that matter.

Tuning knobs: `FOLLOW_SLACK`, `BOTTOM_SNAP_THRESHOLD`, `HISTORY_TRIGGER_MARGIN`,
`PREFETCH_PX`, `REST_MS` in `MessageList.tsx`; `INITIAL_WINDOW`, `WINDOW_STEP`,
`MAX_DOM_MESSAGES` in `core/slicing.ts`; `SCROLL_*` in `core/animateScroll.ts`.
None of them need a rebuild to tune locally — they are frontend constants.

## 9. Companion behaviours taken from the reference client

Not scroll mechanics, but the same client's answers to the same problems — each
one independently reversible:

* **Drafts belong to a conversation** (`core/drafts.ts`, `ChatView`). `ChatView`
  is not remounted on a switch, so the two things that make this correct are
  structural, not careful: the draft **state carries its conversation id** and the
  text is derived during render (a switch is one consistent render — a bare
  `useState` shows the previous chat's text for a frame, which is long enough for
  the composer to mount with it and emit it back into the new chat), and the
  **composer is keyed by the conversation**, because it owns an editor instance,
  an emoji sheet and a reply/edit staging state that must not survive into
  another chat.
  `localStorage`, debounced ~a keystroke and flushed on `pagehide` /
  `visibilitychange`, so a PWA that is swiped closed keeps the text; the store is
  read synchronously at mount, or the box would flash empty and then fill in.
  (Drafts syncing *across devices* is what Telegram does server-side with
  `saveDraft`; that is a separate piece of work, not a storage choice.)
  The body of a message being edited is not a draft: it is applied without
  persisting, and cancel/save give the stored draft back. The switch also drops the
  composer's transient staging (reply target, edit, staged attachments).
* **A quote is a link** (`MessageBubble.onJumpToMessage` → `MessageListHandle.
  scrollToMessage`). Tapping the quoted block jumps to the message and flashes it,
  instead of being inert decoration.
* **The unread marker, and opening where it is.** A chat with unread messages
  opens at the first unread instead of at the newest one: the mounted window is
  seeded *on* that message (`findFirstUnreadKey` + `windowFromSlice`), a
  `.chat-unread-divider` row is rendered before it, and the position lands at the
  top. The marker is captured once, on open — while the reader reads, their own
  read line advances and would take it away under them; the next open simply has
  no marker to place (Telegram's `memoUnreadDividerBeforeIdRef` does the same).
  The boundary itself is `getConversationReadThrough`: the later of the server's
  `last_read_at` and the local read marker. The divider is deliberately not a
  `.message-item`, so the anchor compensation and the read-line search never see
  it as a row.
* **The keyboard moves the panel, never the layout** (Phase 5). The mobile chat
  panel has a constant layout height; `lib/mobileKeyboard.ts` publishes the
  visual-viewport inset and CSS applies ONE compositor-only `translate`. The
  `interactive-widget=resizes-content` hint is deliberately absent: with it,
  Android shrank the layout viewport and re-laid out every mounted row on every
  keyboard frame — the reported "not smooth on Android". The e2e check asserts
  the invariant: setting `--kb-inset: 300px` changes the panel's `translate`
  and the composer's screen position, while `main`, the panel and the message
  area keep their exact heights (no reflow).
* **The keyboard diagnostics strip is opt-in.** It used to be enabled by
  `import.meta.env.DEV`, i.e. on for every developer; now
  `localStorage.setItem("kb-diag", "1")` + reload.

## 9.1 GomoSub channels: the same engine, a document scroller

`ChannelChat.tsx` (GomoSub text channels) runs the same model — one writer per
commit, the anchor invariant, the verified rest, the anchoring gate, a glide for
"to the newest" — with three deliberate differences that come from its layout:

* **The scroller is the window** (`document.scrollingElement`), not an inner
  overflow container. The composer is the page's last flow element, so focusing
  it makes iOS pan the whole page, which is the only keyboard behaviour Safari
  does natively. The engine's primitives take an element, and the root element is
  one: `scrollTop`/`scrollHeight`/`clientHeight` read the document, and the
  anchor switches to **content coordinates** (`rect.top + scrollTop`) because the
  root's own `getBoundingClientRect().top` is `-scrollY`.
* **`content-visibility` stays on channel rows** (a channel keeps a much larger
  window), gated on the behavioural flag — the trade-off from §5 was measured on
  the messenger's per-row layout, where it is not worth it.
* **No bottom snap.** There is no composer overlay above the rows, so a send
  cannot grow a container under a held thumb; the document's own scroll is
  enough.

The channel also keeps its own window ceiling and paging, and its fetch inserts
immediately where the engine anchors scroll (the page arrives mid-coast without
moving the reader) and waits for the rest where it does not.

## 10. Known gaps

Deliberately not in this pass (each is independent and additive). Ranked by
value against the reference client's feature set:

1. **Sticky date pills.** Telegram keeps a floating date at the top of the list
   while scrolling (`useStickyDates`, `position: sticky` + `body.is-scrolling-
   messages`). gomo6's date separator is a centred rule inside the row, so this
   needs a visual decision, not just plumbing. (The messenger has the floating
   pill; GomoSub channels still render the centred rule only.)
2. **Store-level viewport.** The store keeps every loaded message; the list bounds
   the DOM instead. Telegram bounds the *store* (`MESSAGE_LIST_VIEWPORT_LIMIT`)
   and re-fetches a slice around the reader. gomo6's pagination is
   backward-only, so this needs a forward fetch (`since_event_id`) to be complete.
3. **Mobile keyboard.** `syncChrome` compensates a scroller that shrinks while the
   reader is glued, but the full mobile behaviour (`lib/mobileKeyboard.ts`, visual
   viewport, `kb-open` class) has not been checked against the new list on a
   device.
4. **`scrollToMessage` for a very distant target** currently mounts the window
   around the target and glides; a dedicated "jump over N pages" animation would
   read better on slow networks.
