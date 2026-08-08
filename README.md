# Are u Human?

**Are u Human?** is a deliberately human-powered alternative to an AI chatbox. Ask an anonymous stranger a text or drawing prompt, or switch to **play as ai** to answer somebody else and earn credits.

It has a Windows 95-inspired interface, but every response comes from a person — not a language model.

## How it works

1. Enter anonymously; no email, username, password, or public profile is required.
2. Spend one credit to ask for a written answer or a drawing.
3. Another available person can reserve and answer your prompt.
4. Switch to **play as ai** to answer strangers' prompts and earn one credit per accepted answer.
5. Your delivered answers and activity are saved locally in your browser.

One question can wait at a time. Reservations expire after two minutes so unanswered prompts return to the queue.

## Features

- Text prompts and hand-drawn responses
- Anonymous Supabase authentication and server-authoritative credit balances
- Live online human/AI presence counts
- Waiting indicator while an answerer is working
- Skip, reporting, ratings, and protected moderation tools
- Local activity history, with a clear-all option
- Separate Conduct, Terms, and Privacy pages
- Optional Cloudflare Turnstile gate for production abuse protection

## Tech stack

- React 19 + TypeScript + Vite
- Supabase Auth, Postgres RPCs, and Realtime
- Dexie / IndexedDB for browser-local history
- Lottie for the animated waiting indicator

## Run locally

### 1. Set up Supabase

Create a Supabase project and enable **Anonymous sign-ins** in Authentication. Apply every SQL migration in [`supabase/migrations`](supabase/migrations) to the project, in filename order.

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and add your Supabase project values:

```sh
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
# Optional: enables the Cloudflare Turnstile entry check
VITE_TURNSTILE_SITE_KEY=your-turnstile-site-key
```

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required. Never put a Supabase `service_role` or secret key in a `VITE_` variable: Vite exposes those values to the browser.

### 3. Install and start

```sh
pnpm install
pnpm dev
```

## Deploy to Vercel

Import this GitHub repository into Vercel. In **Project Settings → Environment Variables**, add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY` (optional)

Add them to both **Production** and **Preview**, then redeploy. Do not add `SUPABASE_SECRET_KEY`, a service-role key, or other private Supabase server credentials to this browser-only app.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
```

## Safety and privacy

The service is for entertainment, not expert medical, legal, financial, or safety advice. Do not share personal information, links, or meetup plans. Use the built-in reporting controls for harmful prompts or answers.

The application uses anonymous identities and keeps activity history in the current browser. See the in-app **Conduct**, **Terms**, and **Privacy** pages for the detailed rules.
