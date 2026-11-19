# Final app source

This is a snapshot of the active Cloudflare Pages app from `03_app/`. The live site is [team5-swiss-dwellings.pages.dev](https://team5-swiss-dwellings.pages.dev). It uses the separate [Render model server](https://hackathon-team5-swiss-dwellings.onrender.com); this folder does not contain the model or server.

`public/` contains the website, `functions/` contains the Pages Functions, and the two SQL files define the separate prediction and account databases. `wrangler.toml` points to the existing Cloudflare project and databases. The copied configuration targets real resources: do not run remote database initialization or deployment commands unless you intend to affect that project.

Local dependencies, runtime state and secrets are excluded. Use `.dev.vars.example` only as a template for an ignored local `.dev.vars` file. See [the app setup guide](../../03_app/README.md) for setup and [the final submission](../readme.md) for project details.

This is a snapshot; changes to `03_app/` are not automatically reflected here.
