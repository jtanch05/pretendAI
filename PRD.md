# Pretend AI — Product Requirements Document

**Status:** Consolidated MVP specification  
**Version:** 1.0  
**Date:** 7 August 2026  
**Working title:** Pretend AI  
**Initial platform:** Public responsive web application  
**Launch language:** English  
**Minimum age:** 13+

---

## 1. Executive Summary

Pretend AI is an anonymous asynchronous web game in which a user asks a question and one randomly matched real person answers while pretending to be AI. The asker receives one answer and reacts with Like or Dislike.

> **Ask a question. A random human pretends to be AI and answers you.**

The experience should be as easy to understand as a chatbot:

```text
Ask
→ wait
→ receive one human-written answer
→ Like or Dislike
```

The answering loop is:

```text
Pretend to Be AI
→ receive a question
→ answer it
→ earn one credit
→ repeat
```

The visual presentation is intentionally serious and premium: a clinical-white, futuristic AI-company interface surrounding a playful human-powered premise.

### Product promise

> **One question. One stranger. One fake AI answer.**

### Hero copy direction

> **Human intelligence. Artificially presented.**

Supporting copy:

> Ask anything. One random human will answer as the AI.

---

## 2. Product Decisions

The following decisions are fixed for the MVP unless this document is revised:

| Area | MVP decision |
| --- | --- |
| Distribution | Public website |
| Audience | General audience, ages 13+ |
| Language | English only |
| Registration | Not required |
| Identity | Supabase Anonymous Auth |
| Starter balance | One credit |
| Pending-question limit | One per user |
| Answers per question | Exactly one |
| Answer styles | Helpful, funny, absurd, sincere, or convincingly AI-like |
| Answer reservation | 120 seconds |
| Question expiry | Approximately one hour |
| Chat history | Stored only in the user's browser using IndexedDB |
| Server message storage | Temporary operational storage only |
| Backend | Supabase |
| Design direction | Clinical white, weightless typography, monochrome plus signal blue |

The previous Windows 98/classic Mac/retro desktop direction is superseded and is not part of this product specification.

---

## 3. Problem and Opportunity

Most AI chat products remove the human element and optimize for predictable utility. Pretend AI reverses that expectation:

> What if the AI was actually one random human?

The entertainment comes from:

- Writing in the voice of an AI.
- Receiving unpredictable human responses.
- Choosing between sincerity, comedy, absurdity, and imitation.
- Not knowing who wrote the answer.
- Receiving lightweight feedback.
- Earning the ability to ask by answering for someone else.
- Experiencing an expensive-looking AI interface powered by ordinary people.

The game should require very little commitment. A visitor should reach a core action within seconds and complete an answering interaction in roughly one to three minutes.

---

## 4. Goals

### 4.1 Primary goals

The MVP must validate whether users enjoy:

1. Asking strangers questions.
2. Pretending to be AI.
3. Receiving unpredictable human answers.
4. Rating answers.
5. Repeating the ask-and-answer economy.

### 4.2 Operational goals

The MVP must prove that:

- Asynchronous matchmaking works with a relatively small active population.
- One question is reserved by at most one answerer at a time.
- The one-credit economy produces enough answer supply.
- Browser-local history is reliable enough for anonymous use.
- Temporary server content is delivered and purged correctly.
- Abuse and moderation volume remain manageable for a public launch.

### 4.3 Non-goals

The MVP is not:

- A serious AI assistant.
- A source of professional advice.
- A persistent chat service.
- A traditional social network.
- A live multiplayer room.
- A leaderboard or ranked game.
- A replacement for ChatGPT or another AI service.
- A cross-device history system.
- An exact recreation of another brand or website.

---

## 5. Audience and Positioning

### 5.1 Primary audience

- People interested in AI and internet culture.
- Casual web-game players.
- People who enjoy anonymous interactions.
- Humorous or creative writers.
- Users looking for a short entertainment experience.

### 5.2 Age and language

- Users must confirm they are at least 13 before creating content.
- The MVP accepts English questions and answers only.
- Launch-region legal and privacy requirements must be reviewed before public release.
- The service must provide age-appropriate defaults, reporting tools, and clear content rules.

### 5.3 Tone

The visual brand is composed, clinical, and futuristic. The writing is concise, self-aware, and mischievous.

The product must always make the core premise understandable. It may look like a premium AI product, but it must not falsely represent human answers as machine-generated.

Recommended recurring disclosure:

> Powered by people, not AI.

---

## 6. Core Roles and Game Loop

### 6.1 Asker

The asker spends one credit to submit one question.

The question enters the queue and is assigned to one eligible answerer. The asker does not need to keep the website open. When the asker returns on the same browser, the application retrieves any undelivered answer, stores it locally, and displays it.

The asker can:

- Read the answer.
- Like or Dislike it once.
- Report it.
- Continue by answering another question or asking again when they have credit.

### 6.2 Answerer

The answerer selects **Pretend to Be AI** and receives one eligible question.

The answerer can:

- Submit an answer within the reservation period.
- Skip immediately.
- Report the question and release the reservation.
- Earn one credit after a valid answer is accepted.

Answering instructions:

> Answer sincerely, humorously, absurdly, or like a convincing AI. Anything goes within the community rules.

### 6.3 Core loop

```text
New visitor
    ↓
Anonymous session + 1 credit
    ↓
┌──────────────────────────────┐
│                              │
Ask a Question          Pretend to Be AI
│                              │
-1 credit               receive question
│                              │
queued                    answer or skip
│                              │
human answers             +1 credit
│                              │
answer delivered locally ←─────┘
│
Like / Dislike / Report
│
repeat
```

---

## 7. Credit Economy

Credits create a simple give-and-take economy.

| Action | Credit effect |
| --- | ---: |
| First anonymous session | +1 |
| Ask a question | -1 |
| Submit a valid answer | +1 |
| Skip | 0 |
| Timeout | 0 |
| Receive Like | 0 |
| Receive Dislike | 0 |
| Question expires unanswered | Refund +1 |
| Removed question before completion | Refund +1 |

Rules:

- A user may have at most one question in `pending` or `reserved` state.
- A completed question does not prevent the user from asking another question.
- Credits and reputation are separate.
- Likes must not control the base answering reward.
- Dislikes must not remove earned credit.
- All balance changes are server-authoritative, transactional, and idempotent.
- The browser must never directly set a credit balance.

When the user has zero credits:

> You need one credit to ask. Answer someone else's question to earn it.

Primary action:

> **Pretend to Be AI**

---

## 8. Question and Reservation Lifecycle

### 8.1 Question states

```text
created
   ↓
pending
   ↓
reserved
   ├── valid answer submitted → completed_unclaimed
   ├── skip                   → pending
   ├── report                 → moderation / pending or removed
   └── timeout                → pending

completed_unclaimed
   ├── asker downloads answer → delivered
   └── delivery TTL reached   → purged_unclaimed

pending
   └── one-hour TTL reached   → expired + refund

delivered
   └── client acknowledgment  → content purged
```

### 8.2 Reservation rules

- Default reservation duration: 120 seconds, configurable server-side.
- One answerer may hold at most one active reservation.
- One question may have at most one active reservation.
- A question must not normally be shown to multiple answerers simultaneously.
- The server timestamp is authoritative.
- The browser displays the remaining time but cannot extend it.
- A late submission is rejected without awarding credit.
- A skip immediately releases the reservation.
- A reported question is not shown to that reporter again.
- Disconnects rely on the reservation TTL; no fragile immediate disconnect detection is required.

### 8.3 Timer presentation

The timer exists to prevent abandoned reservations, not to create intense pressure.

- First 90 seconds: quiet, low-emphasis countdown.
- Final 30 seconds: visibly elevated warning.
- Final 10 seconds: stronger warning without flashing.
- Timer always includes text; it is never represented by color alone.
- Screen readers must not announce every second.

### 8.4 Skip behavior

- Skip is immediate and does not open a confirmation dialog.
- After skipping, the application attempts to find another eligible question.
- The skipped question returns to the queue.
- The same user must not receive it again during a configurable cooldown.
- Track `skip_count` and `assignment_count` for queue tuning and moderation signals.

### 8.5 Question expiry

- Default unanswered-question lifetime: one hour.
- Expiry is configurable.
- Expiry refunds the asker exactly once.
- Expired content is removed from temporary server storage.
- The local history entry is updated when the user next opens the application.

Copy:

> No one answered this question in time. Your credit was refunded.

### 8.6 Unclaimed answer retention

- An answer that has not been downloaded may remain temporarily available for up to seven days.
- After that period, its readable content is purged.
- The server may retain content-free delivery metadata for abuse prevention and analytics.
- The local question entry should show that the answer was no longer available if the user returns after purge.

---

## 9. Matchmaking

### 9.1 Objective

Give each answerer one valid question that needs an answer while preserving fairness and preventing duplicate assignment.

### 9.2 Eligibility

An answerer must not receive a question when:

- They are the asker.
- It is completed, expired, removed, or under moderation.
- It has an unexpired reservation.
- They recently skipped or reported it.
- They are restricted from answering.
- The content language is unsupported.
- The interaction violates an applicable block or safety rule.

### 9.3 Priority

Among eligible questions, favor:

1. Older questions.
2. Questions that have waited longer.
3. Questions with fewer failed assignments.
4. Questions nearing expiry.

Add slight randomness among similarly ranked candidates. Product copy may say “random stranger,” but the implementation does not need uniform random assignment.

### 9.4 Atomic assignment

Matching and reservation must be one server-side transaction, conceptually:

```text
get_and_reserve_question()
```

It must:

1. Authenticate the user.
2. Confirm the user has no active reservation.
3. Select one eligible question.
4. Lock it against concurrent assignment.
5. Create the reservation and deadline.
6. Return the question and server timestamps.

PostgreSQL row-locking behavior such as `FOR UPDATE SKIP LOCKED` is appropriate for the implementation.

### 9.5 Empty queue

Never leave a user on an endless spinner.

Copy:

> No questions need answers right now.

Actions:

- **Check Again**
- **Ask a Question** when the user has credit
- **View Activity**

---

## 10. Feedback and Reputation

### 10.1 Rating

After receiving an answer, ask:

> Did you enjoy this answer?

Actions:

- Like
- Dislike
- Report

Rules:

- Only the asker may rate the answer.
- Rating may be submitted once.
- Duplicate and replayed requests must not change reputation repeatedly.
- Dislike is not a moderation report.
- Report is not automatically a Dislike.

### 10.2 Reputation

The server may maintain content-free counters:

- Answers submitted.
- Likes received.
- Dislikes received.
- Positive rate.
- Skip rate.
- Timeout rate.
- Report rate.

Public reputation is deferred. Positive-feedback notifications are optional after the core loop is validated.

---

## 11. Browser-Local History

### 11.1 Principle

Readable question-and-answer history belongs to the user's browser, not to a permanent Supabase chat-history table.

> **Supabase delivers. IndexedDB remembers.**

### 11.2 Storage technologies

Use IndexedDB for structured history. A small wrapper such as Dexie may be used for schema versioning, transactions, and query ergonomics.

Use `localStorage` only for small non-authoritative values such as:

- Onboarding completion.
- Sound preference.
- Reduced-animation preference.
- Non-sensitive UI preferences.

Do not store authoritative credits or server state in either browser store.

### 11.3 IndexedDB model

Conceptual stores:

#### `history_entries`

```text
id
role                    asker | answerer
question_id
answer_id               nullable
question_text
answer_text             nullable
status
created_at
answered_at             nullable
delivered_at            nullable
rating                  nullable
last_synced_at
```

#### `drafts`

```text
id
kind                    question | answer
reservation_id          nullable
text
updated_at
```

#### `preferences`

```text
key
value
updated_at
```

### 11.4 Delivery acknowledgment

When an asker retrieves an answer:

1. Fetch the pending delivery using the authenticated anonymous identity.
2. Write the question and answer to IndexedDB in a successful local transaction.
3. Confirm that the local record can be read back.
4. Send `acknowledge_delivery()` to the backend.
5. Purge normal message payloads from Supabase.

The server must not delete readable content before the local write succeeds.

### 11.5 Answerer history

After `submit_answer()` succeeds, the client stores the assigned question and the submitted answer in the answerer's IndexedDB history.

- The accepted server response remains authoritative for whether credit was earned.
- Local history failure must not replay the submission or award another credit.
- If the local save fails, show that the answer was submitted successfully but was not added to local history.
- The active draft may be retained temporarily to allow the user to retry only the local save.

### 11.6 Limitations shown to users

The Activity screen must show:

> History is saved only on this browser. Clearing browser data permanently removes it.

Consequences:

- History is unavailable on another device or browser.
- Clearing site data removes history and may remove access to the anonymous identity.
- Private-browsing history disappears when the private session ends.
- The MVP provides no recovery mechanism.

An optional “Protect My History” account-linking feature may be explored after MVP, but it is not required.

### 11.7 User controls

The Activity screen must include:

- Delete one local history item.
- Clear all local history with confirmation.
- Explanation that deletion cannot be undone.

Clearing local history does not alter server-side credit, moderation, or fraud-prevention metadata.

---

## 12. Temporary Server Content and Retention

### 12.1 Data boundary

Supabase must not function as a permanent chat-history store. It may temporarily hold readable content because asynchronous matching and delivery cannot function without an intermediary.

### 12.2 Data categories

| Category | Examples | Retention direction |
| --- | --- | --- |
| Browser-local history | Complete readable questions and answers | Until user clears browser data |
| Temporary message payloads | Queued question text, undelivered answer text | Until expiry, delivery acknowledgment, or maximum TTL |
| Durable game metadata | IDs, state, timestamps, credit ledger, rating | Product/security retention policy |
| Moderation evidence | Reported question or answer snapshot | Until moderation and appeal retention ends |
| Analytics | Event name, anonymous ID, timing, counts | Content-free and time-limited |

### 12.3 Content deletion rules

- Expired unanswered question payloads are deleted.
- Successfully delivered normal question and answer payloads are deleted after acknowledgment.
- Unclaimed answers are deleted after their maximum retrieval window.
- Durable metadata should replace deleted text with null payload references or content-deleted timestamps.
- Background cleanup must be idempotent.
- Backup and infrastructure retention must be accurately described in the privacy policy.

### 12.4 Reporting exception

If a user reports content from local history, the client uploads a snapshot of that content into the moderation system. This is a deliberate exception to normal content deletion and must be disclosed.

---

## 13. Anonymous Identity

### 13.1 Authentication

Use Supabase Anonymous Auth rather than trusting a browser-generated UUID.

On first eligible visit:

1. Complete age confirmation.
2. Complete invisible CAPTCHA or an equivalent challenge when required.
3. Call anonymous sign-in.
4. Create the game profile and initial credit in one protected server operation.
5. Restore the session automatically on later visits from the same browser.

### 13.2 Identity limitations

- No name, email, phone number, profile, or biography is required.
- Signing out, clearing browser data, or changing devices can make the anonymous identity unrecoverable.
- Creating a new anonymous identity must not be a reliable way to farm starter credits.

### 13.3 Abuse prevention

- Enable CAPTCHA or Cloudflare Turnstile for anonymous sign-ins.
- Apply IP and user-level rate limits.
- Detect rapid identity creation and repeated starter-credit claims.
- Clean up abandoned anonymous Auth users on a defined schedule.
- Do not expose service-role or secret keys to the browser.

---

## 14. Safety, Content Policy, and Moderation

### 14.1 Topic policy

The product allows broad topics, including medical, political, relationship, religious, and personal topics, but it does not allow unrestricted content.

Prohibited content includes:

- Sexual content involving minors.
- Grooming or sexual solicitation.
- Adult sexually explicit content unsuitable for a 13+ service.
- Severe harassment, hate, and credible threats.
- Doxxing or personal identifying information.
- Instructions facilitating serious crime.
- Content encouraging or instructing self-harm.
- Graphic violence.
- Spam, scams, and malicious links.
- Content prohibited by applicable law or platform policy.

### 14.2 Entertainment disclaimer

Display near question creation and answer results:

> Answers come from random people and are for entertainment. Do not rely on them for medical, legal, financial, or emergency decisions.

Urgent crisis or emergency content may be blocked, redirected to appropriate resources, or escalated according to the safety policy rather than sent to a random answerer.

### 14.3 Moderation points

Moderation should occur:

- Before a question enters the public queue.
- Before an answer is delivered.
- When a user submits a report.
- Through retrospective abuse and velocity signals.

Possible outcomes:

- Allow.
- Reject with a clear explanation.
- Quarantine for review.
- Remove and refund.
- Restrict the user.

### 14.4 Reporting

Users can report questions and answers for:

- Spam or scam.
- Harassment or hate.
- Sexual content.
- Dangerous content.
- Personal information.
- Self-harm concern.
- Other.

Reporting a question while answering must release the reservation and prevent immediate reassignment to that reporter.

### 14.5 Admin requirements

The MVP requires a minimal protected moderation console that supports:

- Reviewing quarantined and reported content.
- Viewing necessary interaction metadata.
- Removing content.
- Refunding a question exactly once.
- Warning, restricting, or banning an anonymous identity.
- Recording reviewer actions.
- Resolving reports.

---

## 15. Rate Limits and Anti-Cheating

Protect at least:

- Anonymous session creation.
- Question creation.
- Question assignment.
- Skipping.
- Answer submission.
- Delivery acknowledgment.
- Rating.
- Reporting.

The server must prevent:

- Artificially increasing credits.
- Answering one's own question.
- Holding several active reservations.
- Submitting after expiry.
- Rewarding the same submission twice.
- Refunding the same question twice.
- Rating one answer more than once.
- Manipulating state through browser developer tools.
- Replaying mutation requests.

Use unique constraints, transactional functions, ownership checks, server timestamps, and idempotency keys where appropriate.

---

## 16. Main Screens and UX Requirements

### 16.1 Age gate and first visit

Purpose:

- Confirm the user is at least 13.
- Explain that answers come from people.
- Link to Rules and Privacy.

The gate should be concise and should not imitate a legal document.

### 16.2 Home

Required content:

- Brand mark and product name.
- Hero statement.
- Human-powered disclosure.
- Credit balance.
- **Ask a Question** action.
- **Pretend to Be AI** action.
- Compact navigation to Activity and Rules.

The two core actions dominate the screen.

Suggested hero:

```text
Human intelligence.
Artificially presented.

Ask anything. One random human will answer as the AI.

[ Ask a Question ]   [ Pretend to Be AI ]
```

### 16.3 Ask a Question

Required elements:

- Credit balance.
- Question textarea.
- Character counter.
- One-credit cost.
- Entertainment/safety reminder.
- Cancel and Submit actions.

Rules:

- Maximum 500 characters.
- Server-side and client-side validation.
- Prevent empty or whitespace-only questions.
- Prevent a second open question.
- Save the submitted question immediately to local history.

### 16.4 Question status

Possible states:

- Waiting for someone.
- Being answered.
- Answer ready.
- Expired and refunded.
- Removed and refunded.
- Answer no longer available.

Realtime may update the state, but refreshing or polling must also produce the correct result.

### 16.5 Pretend to Be AI — start

Required copy:

> Answer another person's question. Complete an answer to earn one credit.

Primary action:

> **Find a Question**

### 16.6 Pretend to Be AI — answer

Required elements:

- Question label.
- Readable question text.
- Text countdown and progress indicator.
- Answer textarea.
- Character counter.
- Skip, Report, and Submit actions.
- One-credit reward reminder.

Rules:

- Maximum 750 characters.
- Server-side validation.
- Local draft storage during the active reservation.
- A draft must never be silently attached to a different question.
- Clear the active draft after successful submission or explicit discard.

### 16.7 Submission success

```text
Answer submitted.

+1 credit

[ Answer Another Question ]
[ Back Home ]
```

Do not make the answerer wait for the asker to rate the response.

### 16.8 Answer received

Required elements:

- Original question.
- Human-written answer.
- “Powered by people, not AI” disclosure.
- Like and Dislike actions.
- Report action.
- Entertainment disclaimer.

### 16.9 Activity

Activity is a browser-local history view backed by IndexedDB.

Categories:

- Waiting.
- Answered.
- Answers written.
- Recent.

Required notice:

> Saved only on this browser.

Required actions:

- Open an entry.
- Delete an entry.
- Clear all local history.

### 16.10 Rules and About

Must explain:

- A real person writes each answer.
- Allowed answer styles.
- Content boundaries.
- Reporting.
- Entertainment-only disclaimer.
- Browser-only history limitations.

---

## 17. Error and Recovery States

Provide explicit UX for:

- Connection lost.
- No questions available.
- Question already assigned.
- Reservation expired.
- Insufficient credits.
- Active-question limit reached.
- Content rejected.
- Content quarantined.
- Rate limit reached.
- Question expired.
- Server unavailable.
- Local history unavailable.
- IndexedDB write failure.
- Delivery acknowledgment failure.

If an answer downloads but cannot be saved locally, do not acknowledge or purge it. Explain the problem and offer Retry.

---

## 18. Design Direction

### 18.1 Concept

> **A premium AI laboratory whose intelligence is secretly human.**

The product uses a surgical-white, consumer-technology aesthetic:

- Clinical off-white canvas.
- Near-black typography.
- Signal blue as the single brand accent.
- Weightless type.
- Floating pill controls.
- Large rounded enclosures.
- Extensive negative space.
- Hairline structural borders.
- No decorative application chrome.

The style is inspired by premium technology keynotes and editorial product websites, but must use original branding, imagery, icons, and composition.

### 18.2 Design principles

- Premium surface, playful language.
- One clear decision per screen.
- Immediate comprehension.
- Human disclosure without spoiling the visual joke.
- Large touch targets.
- Mobile-first interaction.
- Accessible contrast and focus.
- No visual clutter.
- No imitation of Augen branding or assets.
- No retro OS metaphors.

---

## 19. Design Tokens

### 19.1 Colors

| Token | Value | Role |
| --- | --- | --- |
| `--color-off-black` | `#0f1012` | Primary text and dark surfaces |
| `--color-pure-black` | `#020201` | Maximum-emphasis text and icons |
| `--color-off-white` | `#f2f2f4` | Page canvas |
| `--color-pure-white` | `#fdfdfd` | Elevated panels and inputs |
| `--color-steel-gray` | `#5e5e5e` | Muted readable text |
| `--color-ash-gray` | `#8f8f8f` | Disabled or decorative text only |
| `--color-signal-blue` | `#0071e3` | Links, focus, interactive outlines |
| `--color-danger` | `#b42318` | Functional error/destructive states only |

Signal blue is primarily text, border, and focus color. It should not become a large decorative fill.

Semantic danger color is an accessibility and safety exception, not a secondary brand accent. Statuses must never rely on color alone.

### 19.2 Typography

Primary recommendation:

```text
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", sans-serif
```

PP Neue Montreal may be used only with an appropriate license.

Weights:

- 350 or 300 for most display and body text.
- 400 for controls and compact labels.
- Do not use weights above 500 in the standard interface.

Tracking:

- Default: `-0.02em`.
- Relax tracking when necessary for small text or readability.

Type scale:

| Role | Desktop | Mobile | Line height |
| --- | ---: | ---: | ---: |
| Caption | 12px | 12px | 1.3 |
| Label | 13px | 13px | 1.3 |
| Body | 16px | 16px | 1.35 |
| Subheading | 18px | 18px | 1.25 |
| Heading | 28px | 26px | 1.15 |
| Display | 52px | 36px | 1.02 |

Do not use 10px text for essential information.

### 19.3 Spacing

Base spacing scale:

```text
4, 6, 10, 12, 16, 22, 30, 34, 50, 69, 94, 113, 144px
```

Desktop:

- Section gap: 90–100px.
- Large-card padding: up to 69px.
- Page horizontal padding: 32px minimum.

Mobile:

- Section gap: 48–64px.
- Card padding: 22–30px.
- Page horizontal padding: 16px.

### 19.4 Radius

| Element | Radius |
| --- | ---: |
| Navigation container | 10px |
| Buttons | 26px |
| Large cards | 54px desktop, 30–36px mobile |
| Main game container | Up to 63px desktop |
| Tags and compact pills | 9999px |

### 19.5 Borders and elevation

- Structural border: `1px solid rgba(0, 0, 0, 0.06)`.
- Fine decorative borders may use 0.5px where rendering remains clear.
- Interactive outline: Signal Blue.
- Keyboard focus: minimum 2px visible focus ring with adequate offset.
- No drop shadows for standard elevation.
- Elevation comes from `#fdfdfd` surfaces on the `#f2f2f4` canvas.
- Do not use decorative gradients.

---

## 20. Layout and Imagery

### 20.1 Layout

- Overall content maximum width: 1200px.
- Functional game panel maximum width: 720px.
- Long-form reading measure: approximately 680px.
- Desktop hero may use a full-viewport composition.
- Hero copy is left-aligned; the visual anchor sits center-right.
- Functional screens prioritize form readability over cinematic layout.

### 20.2 Hero imagery

Use one original, licensed, or generated high-fidelity human portrait as the visual anchor.

Direction:

- Human profile or sculptural portrait.
- Subject dissolves softly into the white canvas.
- Warm human skin or material tones against cool white.
- No direct copy of the supplied reference portrait.
- No stock-photo corporate expressions.
- No dense secondary imagery.

The portrait visually communicates that a person exists inside the machine.

### 20.3 Iconography

- Minimal geometric line icons.
- Consistent stroke and optical size.
- Original brand glyph.
- Icons accompany text; they do not replace essential labels.
- Avoid glossy, cartoon, or retro-computer icon styles.

---

## 21. Component System

### 21.1 Floating navigation pill

Contains:

- Brand glyph.
- Home.
- Activity.
- Rules.
- Credit balance.

On mobile, simplify rather than squeeze all items into a miniature desktop bar.

### 21.2 Primary action pill

- Large touch target, at least 44px high.
- Pure-white or subtle charcoal-wash surface.
- Off-black label.
- Optional blue outline or blue arrow/link glyph.
- Clear hover, pressed, disabled, and focus states.

The two home actions may have equal visual weight because they represent the core role choice.

### 21.3 Blue outline chip

- Full-pill radius.
- Signal-blue text and border.
- Transparent background.
- Used for filters, status selection, and compact actions.
- Not used for long body copy.

### 21.4 Rounded content card

- Pure-white surface.
- 54px desktop radius.
- Hairline structural border.
- No shadow.
- Large internal whitespace.

### 21.5 Form field

- Pure-white surface or inset white panel.
- Comfortable 16px minimum text.
- Clear label outside the field.
- Blue focus ring.
- Character count and validation message below.
- Never rely on placeholder text as the only label.

### 21.6 Timer

- Text time plus quiet linear indicator.
- Neutral at rest.
- Increased contrast near expiry.
- Accessible description for assistive technology.

### 21.7 Feedback controls

- Like and Dislike are large labeled controls, not emoji-only buttons.
- Selected state remains clear after submission.
- Report is available but visually secondary.

### 21.8 Notice panel

Used for:

- Browser-only history.
- Entertainment disclaimer.
- Content rejection.
- Expiry and refund.

Notices use icon, label, and text rather than color alone.

---

## 22. Motion and Sound

### 22.1 Motion

Use subtle motion only:

- 150–250ms control transitions.
- Gentle content reveal.
- Timer progression.
- Credit-count update.
- Answer-ready indicator.

Avoid:

- Constant motion.
- Glitch effects.
- Screen shaking.
- Long loaders.
- Decorative animation that delays interaction.

Respect `prefers-reduced-motion`.

### 22.2 Sound

Sound is optional and deferred unless inexpensive.

If included:

- Off by default or introduced through explicit consent.
- Easy to disable.
- Quiet and modern, not retro-computer themed.
- Never autoplay loudly on page load.

---

## 23. Responsive Behavior

### Mobile: 320–767px

- Single-column layout.
- Full-width form controls.
- 16px page gutters.
- Stack major actions when necessary.
- Simplified navigation.
- Large touch targets.
- Reduced card radius and padding.
- No horizontal scrolling.

### Tablet: 768–1023px

- Centered functional panel.
- More generous spacing.
- Hero may retain split composition when space allows.

### Desktop: 1024px+

- Full editorial canvas.
- Centered floating navigation.
- Hero visual center-right with copy lower-left or center-left.
- Functional game screens remain constrained for readability.

---

## 24. Accessibility

Required:

- WCAG 2.2 AA target.
- Semantic HTML controls.
- Full keyboard navigation.
- Visible focus states that override the decorative hairline-border rule.
- Minimum 44×44px touch targets for primary controls.
- Sufficient text contrast.
- No essential Ash Gray text.
- No color-only status communication.
- Form labels, descriptions, and validation associations.
- Timer text in addition to visual progress.
- Reduced-motion support.
- Screen-reader announcements for meaningful state changes only.
- Like/Dislike text labels in addition to icons.
- Readable 16px question and answer text.

---

## 25. Technical Architecture

### 25.1 Frontend

```text
React
TypeScript
Vite
Zustand
Tailwind CSS
IndexedDB
Dexie or an equivalent thin IndexedDB wrapper
```

Zustand manages current UI state such as:

- Current screen.
- Current assignment.
- Loading and connection state.
- Timer display.
- Cached credit display.
- Modal and notice state.

Zustand is not authoritative for credits, reservations, rewards, or moderation state.

### 25.2 Backend

```text
Supabase
├── Anonymous Auth
├── PostgreSQL
├── RPC / database functions
├── Realtime where helpful
├── Edge Functions where privileged orchestration is appropriate
├── scheduled cleanup/expiry jobs
└── Row Level Security
```

### 25.3 Service boundary

React components communicate through a game-service layer:

```ts
gameApi.createQuestion()
gameApi.getAndReserveQuestion()
gameApi.submitAnswer()
gameApi.skipQuestion()
gameApi.acknowledgeDelivery()
gameApi.rateAnswer()
gameApi.reportContent()
```

Components must not depend directly on the current database schema.

### 25.4 Realtime

Realtime may notify the asker when:

- A question becomes reserved.
- An answer becomes ready.
- A question expires.

Realtime is an enhancement, not a correctness dependency. Refreshing, reconnecting, or polling must return authoritative state.

---

## 26. Server Functions

Sensitive operations must use trusted functions rather than arbitrary client table mutations.

Required conceptual operations:

```text
create_profile_with_starter_credit()
create_question()
get_and_reserve_question()
submit_answer()
skip_question()
report_question()
retrieve_pending_delivery()
acknowledge_delivery()
rate_answer()
report_answer()
expire_questions()
expire_reservations()
purge_delivered_content()
purge_unclaimed_content()
```

Examples of atomic behavior:

### `create_question()`

```text
authenticate
→ verify age-gate state where required
→ check rate limit
→ verify credit ≥ 1
→ verify no open question
→ validate and moderate text
→ deduct credit
→ create temporary payload and question job
→ return question ID and authoritative balance
```

### `submit_answer()`

```text
authenticate
→ verify reservation ownership
→ verify reservation still active
→ validate and moderate text
→ create temporary answer payload
→ complete question
→ award exactly one credit
→ return authoritative balance
```

### `acknowledge_delivery()`

```text
authenticate asker
→ verify ownership and delivery token
→ mark delivered once
→ purge normal readable payloads
→ retain only permitted content-free metadata
```

---

## 27. Conceptual Database Model

### `profiles`

```text
user_id
created_at
last_seen_at
credit_balance
status
answer_count
like_count
dislike_count
```

### `credit_ledger`

```text
id
user_id
amount
reason
reference_id
idempotency_key
created_at
```

### `question_jobs`

```text
id
asker_id
status
created_at
expires_at
payload_id              nullable after purge
reserved_by             nullable
reservation_expires_at  nullable
skip_count
assignment_count
refunded_at             nullable
content_deleted_at      nullable
```

### `question_payloads` — temporary

```text
id
question_id
text
created_at
purge_after
```

### `answers`

```text
id
question_id
answerer_id
created_at
payload_id              nullable after purge
rating                  nullable
delivered_at            nullable
content_deleted_at      nullable
```

### `answer_payloads` — temporary

```text
id
answer_id
text
created_at
purge_after
```

### `question_interactions`

```text
id
question_id
user_id
action                  assigned | skipped | timed_out | answered | reported
created_at
```

### `reports`

```text
id
reporter_id
content_type
content_reference_id
reason
evidence_snapshot
created_at
status
resolved_at
reviewer_id
```

### `idempotency_records`

```text
key
user_id
operation
result_reference
created_at
expires_at
```

The final schema may differ, but it must preserve the data boundary between temporary readable payloads and durable content-free game metadata.

---

## 28. Supabase Security Requirements

- Enable RLS on every table or view exposed through the Data API.
- Use explicit grants; do not assume newly created tables are automatically exposed.
- Restrict every user-owned row with an ownership predicate such as `auth.uid() = user_id` where direct access is appropriate.
- The `authenticated` role alone is not authorization; anonymous users also use that role.
- Do not use user-editable metadata for authorization.
- Keep internal tables and privileged helpers outside exposed schemas where practical.
- Revoke broad function execution and grant only necessary operations.
- Review every privileged function and include explicit authentication, ownership, and input checks.
- Never expose a service-role or secret key in the frontend.
- Run Supabase security and performance advisors before release.
- Pin dependency versions and commit the lockfile.

---

## 29. Analytics

Analytics must not contain readable question or answer text.

Core events:

```text
session_started
age_gate_passed
ask_clicked
question_created
question_assigned
question_skipped
question_timed_out
answer_submitted
answer_downloaded
delivery_acknowledged
answer_liked
answer_disliked
question_expired
credit_earned
credit_spent
report_submitted
local_history_deleted
```

Metrics:

### Engagement

- Questions and answers per anonymous user.
- Repeat-session rate.
- Repeat-loop rate.
- Session duration.

### Matching

- Median time to first assignment.
- Median time to answer.
- Percentage answered before expiry.
- Assignment collision or failure rate.

### Answering

- Completion rate.
- Skip rate.
- Timeout rate.
- Average answer length.
- Submission timing relative to deadline.

### Quality and safety

- Like rate.
- Dislike rate.
- Report rate.
- Moderation rejection rate.
- Reports by category.

### Economy

- Credits earned and spent.
- Average balance.
- Percentage reaching zero.
- Starter-credit abuse indicators.

### Local delivery

- IndexedDB write failure rate.
- Delivery acknowledgment failure rate.
- Unclaimed-answer purge rate.

---

## 30. Provisional Validation Targets

These are beta decision thresholds, not permanent business KPIs:

- At least 80% of observed first-time testers understand the premise without explanation.
- At least 70% of valid questions receive an answer before the one-hour expiry during active testing windows.
- At least 60% of accepted reservations end in a submitted answer.
- At least 50% of delivered answers receive a Like or Dislike.
- At least 25% of activated users complete more than one core action.
- Normal answer delivery and local persistence succeed at least 99% of the time.
- Duplicate rewards and refunds occur zero times in verification testing.
- Moderation backlog remains within the team's documented response capacity.

Targets should be reviewed after the first closed operational test and before broader public promotion.

---

## 31. MVP Scope

### Must have

- Public responsive web application.
- 13+ age gate.
- English-only content.
- Supabase Anonymous Auth.
- One starter credit.
- One open question per user.
- Ask a Question.
- Pretend to Be AI.
- Atomic assignment and reservation.
- 120-second timer.
- Submit, Skip, and Report Question.
- Automatic reservation expiry and requeue.
- One-hour question expiry and idempotent refund.
- Temporary answer delivery.
- IndexedDB local history.
- Delivery acknowledgment and content purge.
- Like and Dislike.
- Report Answer.
- Basic automated moderation.
- Protected moderation console.
- Rate limiting and CAPTCHA.
- Responsive surgical-white visual system.
- Activity and local-history deletion.
- Rules, privacy, and entertainment disclaimer.

### Should have

- Realtime answer-ready notification while the site is open.
- Reconnection to an active reservation.
- Positive feedback notification.
- Basic internal reputation statistics.
- Optional subtle sound.

### Not in MVP

- Multiple answers per question.
- Ask Another Human retry flow.
- Live rooms.
- Private rooms or room codes.
- Friends, followers, or social profiles.
- Leaderboards or ranked mode.
- Images, drawings, voice, or file uploads.
- AI-generated answers.
- Cross-device history.
- Mandatory accounts.
- Native applications.
- Subscriptions or cosmetic store.
- Achievements.
- Complex recommendation or ML matchmaking.
- Public reputation pages.

---

## 32. Development Order

### Phase 1 — Core vertical slice

1. Anonymous Auth.
2. Profile and one starter credit.
3. Ask question.
4. Temporary payload storage.
5. Atomic assignment.
6. Answer form and submission.
7. Credit reward.
8. Local asker and answerer history.
9. Answer retrieval and acknowledgment.
10. Payload purge.

### Phase 2 — Lifecycle resilience

1. Skip.
2. Reservation timeout and requeue.
3. Question expiry and refund.
4. Reconnection.
5. Idempotency and replay protection.
6. IndexedDB failure recovery.
7. Unclaimed-answer cleanup.

### Phase 3 — Feedback and activity

1. Like and Dislike.
2. Activity screen.
3. Local-history deletion.
4. Content-free reputation counters.
5. Realtime enhancement.

### Phase 4 — Safety and public readiness

1. Age gate and Rules.
2. Input moderation.
3. Reporting in both roles.
4. Admin review console.
5. CAPTCHA and rate limiting.
6. Restriction mechanisms.
7. Privacy and retention verification.

### Phase 5 — Visual implementation

1. Design tokens.
2. Responsive layout.
3. Original brand glyph.
4. Original hero portrait.
5. Component states.
6. Motion and accessibility polish.

### Phase 6 — Beta validation

Test:

- Product comprehension.
- Queue liquidity.
- One-credit economy.
- Timer length.
- Skip and completion rates.
- Content delivery and purge.
- Browser-history reliability.
- Moderation workload.
- Mobile usability.

---

## 33. Acceptance Criteria

The MVP is ready for public beta when a new user can:

1. Open the website without registering.
2. Confirm they are at least 13.
3. Receive one starter credit exactly once for the authenticated anonymous identity.
4. Ask one English question and spend one credit.
5. See the question saved in browser-local history.
6. Be prevented from creating a second open question.
7. Have the question enter the queue.
8. Have exactly one eligible answerer reserve it at a time.
9. Never receive their own question as an answerer.
10. Skip or report an assigned question.
11. Have skipped or timed-out questions re-enter the queue safely.
12. Submit a valid answer before the deadline.
13. Earn exactly one credit for a successful submission.
14. Reject late, duplicate, or replayed submissions without duplicate reward.
15. Retrieve an answer after returning on the same browser.
16. Store the complete answer in IndexedDB before acknowledging delivery.
17. Purge normal readable server payloads after successful acknowledgment.
18. Like or Dislike the answer exactly once.
19. Report an answer from local history when necessary.
20. Receive a single refund when an unanswered question expires.
21. Delete one or all local history items.
22. Understand that clearing browser data destroys local history.
23. Use the application with keyboard and assistive technology.
24. Complete the core loop on desktop and mobile browsers.

System verification must also prove:

- No unauthorized cross-user reads.
- No direct browser manipulation of credits or status.
- No duplicate active reservations.
- No duplicate rewards or refunds.
- Cleanup jobs are idempotent.
- Normal analytics contain no message text.
- Reported content follows the separate moderation-retention policy.
- The visual implementation uses original assets and does not reproduce the reference brand.

---

## 34. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Too many askers and too few answerers | Long waits and expiry | One starter credit, one open question, strong answer CTA, active-cohort testing |
| Users clear browser data | Lost history and identity | Prominent local-only notice; optional account linking later |
| Answer lost during local save | Broken core promise | IndexedDB transaction before acknowledgment; retry without purge |
| Anonymous-credit farming | Queue spam and cost | Anonymous Auth, CAPTCHA, IP/user rate limits, ledger, abuse detection |
| Harmful content reaches minors | Safety and legal exposure | Pre-delivery moderation, reporting, restrictions, age-appropriate rules |
| Premium design appears deceptive | Trust damage | Repeat “Powered by people, not AI” disclosure |
| Thin typography reduces usability | Accessibility failure | 16px body, readable contrast, visible focus, minimum touch sizes |
| Temporary content remains indefinitely | Privacy-policy breach | Scheduled TTL cleanup, purge audits, explicit retention metrics |
| Low active population | Empty queue | Staged promotion, scheduled test cohorts, useful empty state |

---

## 35. Future Roadmap

### 35.1 Near-term enhancements

After the asynchronous loop is validated, consider:

- Optional account linking to protect history across devices.
- Optional web notifications for answer arrival.
- “Ask Another Human” after a Dislike, consuming another credit.
- Positive-feedback notifications for answerers.
- Reliable active-user or queue-availability indicators.
- Basic private reputation summaries.
- Exporting local history from IndexedDB to a user-owned file.

### 35.2 Live mode

A later party-game mode may support:

```text
4–8 users
→ same prompt
→ everyone answers
→ answers revealed
→ group voting
→ multiple rounds
```

Live mode is a separate product mode and must not complicate the MVP's asynchronous queue.

### 35.3 Private rooms

Possible later capabilities:

- Room codes.
- Invite links.
- Custom timers.
- Custom content rules.
- Host controls.

### 35.4 Persistent accounts and native clients

Optional later capabilities:

- Email or social login.
- Cross-device credits and history.
- Persistent statistics.
- iOS and Android clients.

Anonymous web play should remain available if accounts are introduced.

### 35.5 Scaling path

Do not build dedicated realtime infrastructure initially. If the Supabase matchmaking path becomes a measured bottleneck, move only the hot path:

```text
React web client
       ↓
Dedicated game/API service
Node.js / Fastify
       ↓
Redis
├── matchmaking
├── reservations
├── rate limits
└── short-lived delivery state

Supabase / PostgreSQL
├── anonymous identities
├── credit ledger
├── ratings
├── moderation
└── durable content-free metadata
```

The `gameApi` service boundary must allow this migration without rewriting React components.

---

## 36. Open Implementation Decisions

These choices do not alter the product definition but must be resolved before production:

- Final product name and domain.
- Original logo and portrait asset.
- Moderation provider and escalation process.
- Exact supported launch regions.
- Privacy-policy retention periods for metadata, reports, and infrastructure backups.
- Whether the IndexedDB wrapper is Dexie or a smaller alternative.
- Whether optional sound enters MVP.
- Exact scheduler used for expiry and cleanup.

---

## 37. Reference Implementation Guidance

Current implementation references:

- [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase breaking changes](https://supabase.com/changelog?types=breaking-change)
- [MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

These links are informative rather than normative. Verify current documentation and changelogs immediately before implementation.

---

## 38. Final MVP Definition

Pretend AI is an anonymous asynchronous human-to-human answering network presented like a premium AI product:

```text
ASKER
asks one question
     ↓
TEMPORARY MATCHMAKING QUEUE
finds one stranger
     ↓
ANSWERER
pretends to be AI
     ↓
ASKER'S BROWSER
saves the delivered answer locally
     ↓
SERVER
purges normal readable content
     ↓
LIKE / DISLIKE / REPORT
     ↓
both continue playing
```

The experience is intentionally simple, visually restrained, and unmistakably human beneath its artificial surface.

> **One question. One stranger. One fake AI answer.**
