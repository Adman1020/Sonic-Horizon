# Sonic Horizon

> ## ⚠️ VIBE-CODED SOFTWARE
>
> This entire project was written by an AI assistant while its human "developer" vibed in the
> background. There are **no tests**, **no type-flagging guarantees**, and the code is best
> described as *"it works on my machine"* — and sometimes not even that.
>
> You should expect the unexpected: sharp edges, undocumented behavior, and the occasional
> existential moment where a feature silently decides not to exist anymore. **Use at your own
> risk, back up your data, and do not run this against anything you cannot afford to lose.**
>
> It is a personal project, not a product. If it breaks, the fix is another AI prompt, not a
> support ticket.

---

## What is this?

**Sonic Horizon** is a self-hosted, single-page web app that generates deep, unbiased, and
highly tailored **music discovery playlists** using Large Language Models.

Instead of relying on Spotify's recency bias or opaque recommendation algorithms, it takes your
**library of liked songs, saved albums, and followed artists on Spotify**, feeds it to an LLM, and
gets back genuinely off-the-beaten-path recommendations — complete with an explanation for
*why* each track was suggested.

The result is written straight into your Spotify account:

- **`Sonic Horizon`** — the latest generation run (replaced every sync)
- **`Sonic Horizon Archive`** — an append-only, **duplicate-free** history of every recommendation ever made

![Sonic Horizon](public/screenshot.png)

## Features

- **Scored artist pool** — your Spotify liked songs, saved albums, and followed artists are combined into a single scored artist pool; the top scores become the discovery seeds
- **Taste focus & obscurity controls** — skew seeds toward your strongest signals, and dial from mainstream to deep underground
- **Hard exclusion baseline** — everything already in your library is code-side forbidden, so the LLM can never re-recommend it
- **LLM-generated picks** — every recommendation comes with reasoning and genre tags
- **6 LLM providers** — OpenAI, Anthropic, Google Gemini, OpenRouter, Microsoft Azure AI Foundry, or local Ollama (free-tier friendly)
- **Spotify sync** — creates/updates your current playlist, archives everything into a deduplicated history playlist
- **Inline Spotify players** — each result embeds a compact player so you can preview before pushing to Spotify
- **Multi-user + admin panel** — a single shared admin-configured AI provider, per-user Spotify-account approval, and rate limits
- **Encrypted storage** — the admin AI key is encrypted at rest in the local database
- **Fully self-hosted** — no phone-home, runs in Docker or directly on Unraid

---

## Running it

### Docker Compose (easiest)

```bash
docker compose up -d --build
```

Open <http://localhost:8080> and sign in with Spotify (the first login becomes
the initial admin; later logins need admin approval). That's it.

The container mounts these volumes (all defined in `docker-compose.yml`):

| Volume | Purpose |
| ------ | ------- |
| `db-data` (named volume) | Everything the app persists — SQLite database (`pde.db`) and encrypted settings — kept on a named volume so WAL-mode writes stay on the container VM's native filesystem |
| `./config` | Config files |

### Unraid

The app publishes a ready-to-use template via the
[unraid-templates](https://github.com/Adman1020/unraid-templates) repo:

- Image: `ghcr.io/adman1020/sonic-horizon:latest`
- WebUI: port **8080**
- App data: whatever folder you set in the Unraid UI (mapped to `/config`)

**Everything lives in the single AppData folder you choose in the UI.** The template exposes one
path — **App Data** (`/config`) — and the app writes its database (`pde.db`) and encrypted settings
inside that folder. No other folders are created: on Unraid
a `/config` path is auto-filled to `/mnt/user/appdata/<container-name>` (e.g. `SonicHorizon`), and
whatever you set there is what gets used — honor it in the UI and that's where everything goes.

If you previously saw two folders (e.g. `SonicHorizon` and `sonichorizon`), that was an old
template bug: a second hard-coded `Uploads Data` mount sent uploads to a different folder than the
database. The updated template removes that second mount. Keep the folder your container's **App
Data** mapping points at (check the container's **Edit** screen), and delete the other.

**Environment variables — no `.env` file needed.** Unraid containers get env vars from the
template, not a `.env`. The template includes `JWT_SECRET`, `ENCRYPTION_SECRET`,
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `APP_BASE_URL` fields:

1. In the Unraid WebGUI, go to **Docker → your SonicHorizon container → Edit** (Advanced View).
2. Generate the two secret values (run this twice, once per field):
   ```bash
   openssl rand -hex 32
   ```
3. Set **JWT Secret** and **Encryption Secret** to those values. Paste your Spotify app's
   **Client ID** / **Client Secret**, and set **APP_BASE_URL** to the public address you reach
   the app at (e.g. `https://sonic-horizon.mydomain.com`) — this must match the Redirect URI
   registered in your Spotify Dashboard. Then hit **Apply**.

The app refuses to start until all five are set. If you're updating an existing container that was
created before these fields existed, add them manually under **Add another Path, Port, Variable**
→ **Variable**, or re-create the container from the updated
template (keep the same AppData path so your data persists).

The Unraid docker-screen icon is pulled from
`public/icon.svg` in this repo and matches the header/favicon logo.

### Environment variables (before first run)

The container fails fast if any required variable is missing, so a misconfigured
boot fails loudly instead of half-starting. Spotify OAuth **is** the app's login
method, so the client credentials are mandatory.

1. Copy the template: `cp .env.example .env`
2. Generate two random secrets:
   ```bash
   openssl rand -hex 32   # run this twice, once per variable
   ```
3. Create a [Spotify app](https://developer.spotify.com/dashboard) and paste its
   Client ID and Client Secret in, plus your public URL as `APP_BASE_URL`.
   `docker compose` will refuse to start until all five are set.

| Variable | Required | What it's for |
| -------- | -------- | ------------- |
| `JWT_SECRET` | ✅ | Signs login sessions |
| `ENCRYPTION_SECRET` | ✅ | Encrypts the admin-configured AI provider key at rest |
| `SPOTIFY_CLIENT_ID` | ✅ | Container-level Spotify OAuth client (login) |
| `SPOTIFY_CLIENT_SECRET` | ✅ | Container-level Spotify OAuth secret (login) |
| `APP_BASE_URL` | ✅ | Public URL users reach the app at (no trailing slash). Must match the Redirect URI registered in Spotify: `<APP_BASE_URL>/api/spotify/callback` |
| `TZ` | ❌ | Defaults to `UTC`. Controls when Scheduled Refreshes fire (cron runs in server-local time) |

`DATABASE_URL` is set inside `docker-compose.yml` (`file:/data/db/pde.db`) — no need to
touch it. When running the Unraid template (which has no compose file), it defaults to
`file:/config/pde.db`, so the database lives inside your AppData folder.

> **On Unraid there is no `.env` file** — set these values as template variables in the
> container's edit screen instead (see [Unraid](#unraid) above).

## Integrations & what you'll need

> **What goes where:**
> - **`.env` (container-level)** → `JWT_SECRET`, `ENCRYPTION_SECRET`, `SPOTIFY_CLIENT_ID`,
>   `SPOTIFY_CLIENT_SECRET`, `APP_BASE_URL` (see [Environment variables](#environment-variables-before-first-run)).
> - **In the app (admin only)** → the LLM provider, model, and API key, configured once in the
>   Admin panel → AI Configuration. Stored **encrypted in the database** and shared by every user.

The app needs **one LLM provider** to function, and **Spotify** for both login and feeding
it your liked songs, saved albums, and followed artists.

### Spotify

Spotify credentials are **container-level** (set in `.env` / the Unraid template), because
Spotify OAuth doubles as the app's login method. No per-user Spotify keys are stored.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Under **Settings**, add your Redirect URI — `<APP_BASE_URL>/api/spotify/callback`
   (e.g. `http://127.0.0.1:8080/api/spotify/callback` for local testing). `APP_BASE_URL` is
   set in the container env, so register the host you'll actually use.
3. Put the app's **Client ID** and **Client Secret** in `.env` (or the Unraid template) and
   restart the container.
4. The app requests these OAuth scopes on connect:

```
user-read-email
user-library-read
user-follow-read
playlist-read-private
playlist-modify-public
playlist-modify-private
ugc-image-upload
```

5. In the app, hit **Connect Spotify** and approve the OAuth flow.

### Scheduled Refreshes

Enable **Scheduled Refreshes** in its own collapsible section (above the Generate button) to
automatically refresh your Spotify signals and generate a fresh "Sonic Horizon" playlist on a
schedule (daily / weekly / monthly, with a run-day picker). Enabling a schedule locks the
tuning + Generate controls to the settings saved at that moment; "Run now" force-runs
regardless. The schedule runs inside the container's own process, so the container must stay
running. Times are interpreted in the container's `TZ`. A scheduled run never repeats artists
you've already received — every pushed pick is recorded as known and excluded on later runs.

### LLM provider (pick one)

| Provider | Get a key | Free tier notes |
| -------- | --------- | --------------- |
| **Google Gemini** | [AI Studio](https://aistudio.google.com/app/apikey) | Generous free tier — best starting point (outside EU/UK) |
| **OpenRouter** | [Keys](https://openrouter.ai/keys) | Free models available; use `openrouter/free` as the model |
| **OpenAI** | [API keys](https://platform.openai.com/api-keys) | ~$5 new-account credit |
| **Anthropic** | [Console](https://console.anthropic.com/) | Prepaid credits only |
| **Azure AI Foundry** | [Azure portal](https://ai.azure.com/) | Requires a deployed model; key format `endpoint::key` |
| **Ollama** (local) | – | Runs fully offline; URL defaults to `http://host.docker.internal:11434` |

Configure the provider in the Admin panel → **AI Configuration**. The key is encrypted at rest in your local database.

---

## How discovery works

1. **Ingest** — Spotify only: your **Liked Songs, Saved Albums**, and **Followed Artists**.
   These three explicit-likes sources are fetched on refresh. No play history, no recently
   played, no playlists, no Last.fm, no file uploads — only what you actively like/save/follow.
2. **Score** — every artist gets a score from per-source signals (followed / saved / liked);
   the top `SEED_LIMIT` become the seed pool, and the rest form a hard exclusion baseline.
3. **Generate** — one LLM call asks for new picks against that seed pool, constrained by the
   exclusion list, your obscurity setting, and the selected discovery mode (Deep Roots,
   Genre Dive, Album Quest, or Rabbit Hole).
4. **Verify** — picks are matched against Spotify; only real tracks/albums survive.

## How the sync works

1. **Read** — every track in `Sonic Horizon` is fetched (paginated).
2. **Archive** — those tracks are appended to `Sonic Horizon Archive`, deduplicated so nothing is
   ever added twice.
3. **Resolve** — the LLM's recommendations are searched on Spotify and deduped.
4. **Replace** — `Sonic Horizon` is overwritten with the new picks (safe-skip if the run
   produced nothing).

Your archive is the durable record; the current playlist is just the latest snapshot.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
- [Prisma](https://www.prisma.io) ORM over SQLite
- JWT sessions (jose), AES-GCM encrypted API-key storage
- Docker / GitHub Actions → GHCR

## Project layout

```
.github/workflows/   CI: build+push to GHCR, Unraid template sync
.unraid/            Unraid template source
app/                Next.js App Router routes + UI
lib/                Spotify, LLM, auth, scoring, scheduling, encryption, Prisma
prisma/             Database schema
public/             Static assets + screenshots
```

---

**TL;DR:** it's vibe-coded, it might break, back up your playlists, and blame the AI — not
yourself.
