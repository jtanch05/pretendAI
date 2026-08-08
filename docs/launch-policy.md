# Pretend AI launch policy

Pretend AI is a human-powered entertainment game: each answer is written by a real person, not an AI. It is not advice and must not be used for medical, legal, financial, safety, or other important decisions.

## Participation and content

The beta is for people aged 13 or older in Malaysia. Do not post personal information, contact details, threats, sexual content involving minors, harassment, doxxing, self-harm encouragement, illegal content, or attempts to arrange an offline meeting. Players can report an assigned question or a delivered answer; moderators can remove server content and restrict abusive anonymous identities.

## Data and retention

Activity history stays in the browser until the player deletes it or clears browser data. Questions are readable on the server for up to one hour; undelivered answers are readable for up to seven days. Delivered content is removed from the server after the client safely saves it. Reports retain the minimum content evidence for 30 days, then evidence is replaced by a purge marker; non-content operational metadata is retained for monitoring and safety. Backups may retain deleted records for the provider's backup window.

## Required production configuration

1. In Supabase Auth > Protection, enable CAPTCHA protection, choose Cloudflare Turnstile, and add the Turnstile secret key.
2. Set `VITE_TURNSTILE_SITE_KEY` in the deployed web app and allow the production and localhost domains in Turnstile.
3. Configure Supabase Auth anonymous-sign-in/network rate limits appropriate for the beta and monitor Auth logs for creation spikes.
4. Grant moderator access only by trusted updates to `app_metadata.role = "moderator"`, then require a token refresh.
