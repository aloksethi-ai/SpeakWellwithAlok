# SpeakWell - AI Speech Coach (open source)

Single-page speech coach (camera + microphone, Toastmasters-style evaluation) with an optional
registration gate that stores Name, Email, City and WhatsApp number in **your own Google Sheet**.

```
public/index.html      the app (registration gate + speech coach)
public/privacy.html    privacy notice TEMPLATE (fill the [[placeholders]])
api/register.js        validates + forwards registrations (Vercel serverless function)
api/event.js           records anonymous "session completed" events
api/_shared.js         validation, rate limit, forwarding helpers
apps-script/Code.gs    Google Apps Script that writes to the Sheet
tests/api.test.js      `npm test` - 12 checks, no dependencies
```

Data flow: browser -> `/api/register` (Vercel) -> Apps Script (secret) -> Google Sheet.
The Sheet URL and secret live only in Vercel environment variables, never in the repo or browser.
Recordings, transcripts and reports never leave the user's device.

## 1. Google Sheet + Apps Script (10 minutes)
1. Create a new Google Sheet (name it e.g. "SpeakWell users"). Keep it private.
2. Extensions > Apps Script. Delete the sample code, paste `apps-script/Code.gs`, save.
3. Select function `setup` > Run > authorise. Open **Execution log** and copy the `SECRET` value.
   (This creates the tabs Registrations, Usage and Stats.)
4. Deploy > New deployment > type **Web app** > Execute as **Me** > Who has access **Anyone** > Deploy.
   Copy the Web app URL (ends with `/exec`).
5. If you edit the script later: Deploy > Manage deployments > pencil icon > Version: New version.

## 2. Put the code on GitHub
```
git init && git add . && git commit -m "SpeakWell"
```
Create a **public** GitHub repo and push. Safe to publish: no secrets are in the repository.
Replace `[YOUR NAME / ORGANISATION]` in `LICENSE`.

## 3. Deploy on Vercel
1. vercel.com > Add New > Project > import the repo. Framework preset: **Other**. No build command.
2. Settings > Environment Variables (Production):
   - `SHEET_WEBHOOK_URL` = the `/exec` URL
   - `SHEET_SECRET` = the secret from step 1.3
   - optional `ALLOWED_ORIGINS` = your custom domain, e.g. `https://speakwell.yourdomain.com`
3. Deploy (redeploy after adding variables). Vercel serves the site over HTTPS, which camera/mic need.

## 4. Before you go live (checklist)
- [ ] Run `grep -rn '\[\[[A-Z]' public` and fill every placeholder (`public/privacy.html`, footer email in `public/index.html`).
- [ ] Have your legal adviser review the privacy notice and consent wording (DPDP Act, 2023).
- [ ] Open the site in a private window, register, confirm the row appears in the Sheet.
- [ ] Complete one practice session and confirm a row appears in `Usage` and the numbers move in `Stats`.
- [ ] Share the Sheet with nobody, or only people who need it; enable 2-step verification on that Google account.
- [ ] In Vercel enable Firewall > Rate limiting for `/api/*` (the built-in limiter is best-effort only).
- [ ] Test with `curl`:
```
curl -s -X POST https://YOUR-SITE.vercel.app/api/register -H 'content-type: application/json' \
  -d '{"name":"Test User","email":"test@example.com","city":"Ajmer","whatsapp":"9876543210","age18":true,"consent":true,"marketing":false,"consentVersion":"v1"}'
```

## Your user count
Open the Sheet > **Stats** tab: total users, registered today, marketing opt-ins, sessions completed,
unique active users and average score update automatically. Raw rows are in **Registrations** and **Usage**.

## Handling requests from users
- Access / correction / withdrawal / erasure: users email you from their registered address. Search the
  Registrations tab by email and edit or delete the row; delete matching Usage rows by Registration ID.
- Only message people on WhatsApp/email for marketing if `Marketing opt-in` is **Yes**. Service messages
  are covered by the required consent. Use WhatsApp Business (templates, opt-out) and include an unsubscribe line.

## Known limits (be aware)
- No email/OTP verification: someone can enter another person's details. For stricter control add an
  OTP step or a CAPTCHA (e.g. Cloudflare Turnstile) before `/api/register`.
- Registering again with the same email returns the existing record (no duplicate row).
- Clearing browser data asks the user to register again (it re-uses their row, no duplicate).
- The page sets no Content-Security-Policy because the face model loads scripts/WASM from CDNs; add one only
  after testing it in a browser.
- Forks that do not want data collection: set `requireRegistration: false` in the `gate-script` block of
  `public/index.html`; the app then makes no server calls.

## Local test
`npm test` runs the API checks against a fake Sheet endpoint. For the full stack locally: `npx vercel dev`.

License: MIT (see LICENSE).
