# Swiss Dwellings app

**Team 5:** Breno Sader, Diego Alpizar, Sindhuja Davuluri and Soumyajyoti Datta.

[Live app](https://team5-swiss-dwellings.pages.dev) · [Render model server](https://hackathon-team5-swiss-dwellings.onrender.com) · [Model card](https://huggingface.co/iaac-maai/hackathon-team5-swiss-dwellings) · [Final submission](../04_final/readme.md)

## Using the app

Create an individual account, log in with an existing account, or select team access to enter using the shared password without creating an account. New personal passwords need at least eight characters, including uppercase and lowercase letters, a number and a special character. The team password and the private course test-account credentials belong in the **course hand-in**, never in this repository. The course guide asks that the shared password be required for everyone; optional team access differs from that requirement.

Select a historical apartment example or enter 24 apartment-level features; choose improvement goals and evaluate it. The app displays a reconstruction-error score, threshold, error contributions and up to five reference matches. The fixed question buttons explain the results. The labels “Market Ready” and “Need Renovation” are model-based group labels, not verified market or renovation assessments; illustrative bubble diagrams are not actual floor plans.

If Render has gone to sleep, the first request can take time or fail; wait a minute and retry. On 19 November the live request succeeded after the server was restarted.

## Architecture and privacy

Cloudflare Pages serves the static interface. Pages Functions authenticate either personal accounts or team access, validate inputs, call Render's Gradio API, and save successful analyses in D1. The model server uses ONNX and a derived reference catalog; the model is published on Hugging Face.

Account hashes and sessions are held in the separate `team5-swiss-users` D1 database. Predictions are stored in `team5-swiss-dwellings-db`. The website does not expose history or an account list; consequently, users cannot reopen their own saved results after a reload. Predictions are not currently associated with account IDs. No file uploads are accepted, so R2 is not used.

The account system does not verify email addresses and does not yet support password recovery. Treat this as a hackathon prototype.

## Design comparison

The original diagrams described a shared-password-only entry, an accessible history page and a React build. The implemented website uses static HTML and JavaScript, individual accounts or an optional team-password entry, and keeps prediction history inaccessible at the team's request. It offers agent and architect views over the same result rather than separate model requests. The [final diagrams](../04_final/diagrams/) need an update for the optional entry; candidate filters may return fewer than five matches.

## Files

| Path | Purpose |
|---|---|
| `public/` | Login and apartment interface, styles and client logic |
| `functions/_middleware.js` | Session and same-origin checks |
| `functions/auth.js`, `functions/api/login.js`, `register.js`, `logout.js` | Account and shared-password authentication |
| `functions/api/predict.js` | Validate input, call the model and save successful results |
| `functions/api/history.js` | Blocks website access to saved history |
| `schema.sql`, `users_schema.sql` | Schemas for the separate prediction and account databases |
| `wrangler.toml` | Pages configuration, model URL and database bindings |

## Local setup and deployment

Install Node 22 or newer and the pinned project dependencies, then initialize the two **local** databases:

```bash
cd 03_app
npm ci
npx wrangler d1 execute team5-swiss-dwellings-db --local --file=schema.sql
npx wrangler d1 execute team5-swiss-users --local --file=users_schema.sql
npm run dev
```

For local team access, put `APP_PASSWORD` in an ignored `.dev.vars` file. Configure a Pages secret of the same name for production. Do not commit either secret. Production database bindings are already recorded in `wrangler.toml`; do not recreate them. From this folder, `npm run deploy` publishes the existing Pages app. Use the production branch when deploying the final submission.

The Wednesday design diagrams in this folder are historical; refer to the corrected [final diagrams](../04_final/diagrams/). See [proofs](../04_final/PROOFS.md) for live checks and limitations.
