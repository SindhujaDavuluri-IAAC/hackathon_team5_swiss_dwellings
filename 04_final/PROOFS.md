# Submission proofs

Checks recorded on 19 November 2026. Do not put the team password, test-account credentials, tokens or personal information in this file.

## 1. A database

Commands run from `03_app/` against Cloudflare:

```text
wrangler d1 execute team5-swiss-dwellings-db --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
Result: _cf_KV, predictions

wrangler d1 execute team5-swiss-users --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
Result: _cf_KV, auth_attempts, sessions, users
```

These are two separate databases: one stores predictions and one stores account and session records.

## 2. Locked on the server

```text
curl -i https://team5-swiss-dwellings.pages.dev/api/predict

HTTP/1.1 401 Unauthorized
Content-Type: application/json
{"error":"Please log in."}
```

Signing in or registering uses an individual account. A separate option permits entry with the team password alone; it is checked on the server as a Cloudflare secret. **The course guide says the shared password must remain required for everyone:** this optional flow does not meet that requirement and should be clarified with the instructors.

## 3. Connected to Render

[Live result screenshot](proof_live_result.png) — captured from the website after registration and a successful model call. The screenshot shows score 0.3693, threshold 0.1799 and five reference matches.

From `03_app/wrangler.toml`:

```toml
MODEL_URL = "https://hackathon-team5-swiss-dwellings.onrender.com"
```

An additional programmatic check returned HTTP 200, score 0.03138 and three matches. Two earlier checks returned 503 while Render was unavailable; the team restarted it and the retry succeeded. Wake and retest the service before the demo.

## 4. No secrets in Git — scoped check

`.dev.vars` is listed in `.gitignore` and is not tracked. The production Pages secret listing showed `APP_PASSWORD: Value Encrypted`; its value was not retrieved or recorded.

A signature-based scan of the 49 local commits reachable from all local refs found no matches for common Hugging Face, OpenAI or GitHub token formats and no matches for the team password from the local secret file. This is a limited check, not proof that every possible credential is absent from all Git histories or all Cloudflare resources. Review the team repository's remote branches, GitHub secret scanning and Cloudflare account independently before claiming a complete audit. Never paste a suspected secret into the submission.

The 44,195-apartment derived NPZ catalog has been removed from Git tracking for the next commit; the server can fetch the matching SHA-256-verified catalog from Hugging Face. Previously committed Git history still contains it. Other small dataset-derived examples in the repository require team review against the course's data rule.

## 5. Login works

- [Sign-up page](proof_signup.png)
- [Optional team-access page](proof_team_access.png)
- [Logged-in website](proof_logged_in.png)
- [After logout](proof_logout.png)

The temporary screenshot account was removed. Registration, login, wrong credentials, logout and an unauthenticated session were also checked through the API.

## 6. Own data only

Two temporary accounts were registered separately. A request to `/api/history` returned **404** for each; the website exposes no history or account-list endpoint, so user B cannot view user A's saved rows through that endpoint. The temporary accounts were removed.

**Limitation:** predictions are not associated with user IDs, and no one can reopen their own saved rows in the website. This check does not demonstrate owner-scoped history or fully satisfy a requirement that each user can see *their own* saved records. Changing that would require a user-ownership design and access controls; the team previously requested that the history remain hidden.

## Still needed

- Review and write the three statements in the team's own words.
- Provide the team password and a test account privately in the course hand-in.
- Decide with the instructors whether the disabled history meets proof 6, or implement private per-user history with the team's agreement.
- Complete the broader credential audit, review the remaining derived example data and ensure the final changes are pushed to the team repository's `main` before the freeze.

