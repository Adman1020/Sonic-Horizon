# Product Specification: Personal Discovery Engine (PDE)

**Document Version:** 4.0 (Final Architecture & Design Specification)  
**Target Execution Environment:** Anti-Gravity Autonomous Code Generator  
**Deployment Target:** Self-Hosted Docker / Unraid OS  

---

## 1. Executive Summary & Core Principles

### 1.1 Objective
The **Personal Discovery Engine (PDE)** is a lightweight, self-hosted single-page web application designed to generate deep, unbiased, and highly tailored music discovery playlists. By ingesting a user's *all-time* historical listening data (via Spotify and/or Last.fm) and processing it through Large Language Models (LLMs), PDE uncovers hidden artists, albums, and tracks that match deep preference patterns without being distorted by Spotify’s recency bias, promotional placement, or opaque back-end algorithms.

### 1.2 Core Guiding Principles
* **Anti-Recency Bias:** Evaluates long-term and structural taste profiles across years of data rather than just recent plays.
* **Tier-Aware Ingestion:** Works out of the box for users on free tiers of Spotify and Last.fm without requiring paid subscriptions, with clear UI pathways for API vs. manual file imports.
* **Complete User Isolation:** Multi-tenant architecture allowing an admin to manage user accounts, while each user’s API keys, listening history, local file uploads, and recommendation archives remain completely segregated.
* **Bring Your Own Key (BYOK):** Users manage their own AI provider API keys (OpenAI, Anthropic, Google Gemini, OpenRouter) with built-in rate-limiting controls.
* **Zero-Popup Linear UI:** A mobile-optimized, single-page linear workflow ("scroll and execute") with no modal popups, sub-pages, or distracting context switches.
* **Zero-Duplicate Archival System:** Maintains an "ever-recommended" database per user to guarantee that no artist or track is ever recommended twice.

---

## 2. Branding & Naming Options (For Selection)

Below are five curated naming concepts for the application. The final choice can be configured via an environment variable (`APP_NAME`) or picked during initial setup.

| Option | Name | Tagline | Brand Identity & Vibe |
|---|---|---|---|
| **Concept A** | **CrateDig** | *Unearth the hidden depths of your taste.* | Classic crate-digger aesthetic; evokes digging through vinyl stacks for hidden gems. |
| **Concept B** | **Outlier** | *Music discovery beyond the mainstream algorithm.* | Edgy, independent, focused on finding deep-cut artists off the beaten path. |
| **Concept C** | **DeepCrate AI** | *All-time history. Zero recency bias.* | Clean, technical, and analytical approach to long-term music taste profile synthesis. |
| **Concept D** | **Resonance** | *Recommendations tuned to your true listening history.* | Elegant, acoustic, audiophile-focused; emphasizes deep harmonic alignment with user taste. |
| **Concept E** | **Unbound Music** | *Break free from Spotify's recommendation loop.* | Liberating, open-source, user-sovereign discovery utility. |

---

## 3. Visual Design System & UI Themes (For Selection)

The UI is built using Tailwind CSS and responsive layout primitives. The code generator should implement **Theme Option 1 (Analog Hi-Fi)** as the default, with CSS variables allowing easy toggling to the other options.

### Option 1: Analog Hi-Fi & Warm Dark Slate (Default - Recommended)
* **Color Palette:** 
  * Background: Deep Obsidian / Dark Slate (`#121316` / `#1A1B20`)
  * Text: Warm Off-White (`#E5E7EB` / `#F3F4F6`)
  * Accents: Brushed Amber & Warm Gold (`#D97706` / `#F59E0B`)
  * Borders & Cards: Soft Charcoal (`#27272A`)
* **Visual Feel:** Feels like a high-end vintage audio receiver. Warm amber LED indicator dots, subtle VU meter style status bars, clean typography, and tactile dark controls. Extremely easy on the eyes for night scrobbling and mobile use.

### Option 2: Swiss Minimalist & Editorial Monochrome
* **Color Palette:**
  * Background: Clean Stark White (`#FFFFFF`) or Deep Black (`#0A0A0A`)
  * Text: High-Contrast Monochromatic Black/White
  * Accents: Electric Red or Acid Yellow (`#EF4444` / `#EAB308`) for action buttons
  * Borders: Sharp 1px solid lines
* **Visual Feel:** High-fashion music magazine / vinyl catalog index. Bold sans-serif headers (Inter / Helvetica), heavy line dividers, stark numbers for step indicators (01, 02, 03).

### Option 3: Cyber Audio Terminal (Retro-Futuristic)
* **Color Palette:**
  * Background: Pure Pitch Black (`#050505`)
  * Text: CRT Phosphor Green (`#10B981`) or Cyan (`#06B6D4`)
  * Accents: Neon Violet (`#8B5CF6`)
  * Containers: Dark Monospace Code Cards with subtle scanlines
* **Visual Feel:** Command-center feel for homelabbers and music collectors. Real-time streaming log terminal output, code-like toggles, monospace font accents for stats.

### Option 4: Warm Vinyl & Terracotta Craft
* **Color Palette:**
  * Background: Warm Sand / Cream (`#FDFBF7` in light, `#1E1C1A` in dark)
  * Text: Deep Espresso (`#2C2523`)
  * Accents: Terracotta / Rust (`#C85A32`) & Muted Sage (`#657A60`)
* **Visual Feel:** Artisanal coffeehouse vinyl lounge. Soft rounded corners, tactile shadows, organic feel.

---

## 4. Architecture & Self-Hosting (Unraid & Docker)

### 4.1 Technology Stack
* **Frontend/Backend:** Next.js (App Router) or Node.js / Express + React (TypeScript) running as a unified monolithic container.
* **Database:** SQLite (via Prisma or Drizzle ORM) stored on a persistent volume, providing isolated schemas or user-keyed storage for multi-tenancy.
* **Styling:** Tailwind CSS with responsive layout primitives optimized for mobile and desktop screens.
* **State & File Storage:** Local server-side encrypted storage for user configuration files and uploaded streaming history JSON/CSV files.

### 4.2 Docker & Unraid Deployment Specification
* **Containerization:** Single Docker container exposing a configurable HTTP port (default `8080`).
* **Environment Variables:**
  * `PORT`: Server listening port (default `8080`).
  * `DATABASE_URL`: Path to persistent SQLite database (e.g., `/config/pde.db`).
  * `ENCRYPTION_SECRET`: Secret key for encrypting stored user API keys at rest.
  * `ADMIN_INIT_PASSWORD`: Default password for initial admin setup.
  * `APP_NAME`: Configurable app title (default: `CrateDig`).
* **Volume Mounts:**
  * `/config`: SQLite database file and encrypted user settings.
  * `/data/uploads`: User-uploaded listening history files (isolated by `user_id`).

### 4.3 CI/CD & Unraid Application Template Directive
> **Anti-Gravity Directive:** Include a `.github/workflows/deploy-unraid-template.yml` GitHub Action workflow. Upon container build and release tag push, this workflow automatically updates the Unraid Community Applications XML template repository. *Query the user’s reference repository for the existing Unraid CI/CD GitHub Action template structure.*

---

## 5. Multi-Tenancy & User Access Control

To keep deployment simple without requiring complex federated authentication setup (e.g., running a custom Spotify Auth server login), authentication is managed locally by a built-in lightweight Admin interface.

```
┌─────────────────────────────────────────────────────────────┐
│                       ADMIN PORTAL                          │
├─────────────────────────────────────────────────────────────┤
│ • Create / Deactivate User Accounts (Username + Password)   │
│ • Reset User Passwords                                      │
│ • View System Health & Active Storage Usage                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Creates credentials for
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    ISOLATED USER SPACE                      │
├─────────────────────────────────────────────────────────────┤
│ User A Data                  │ User B Data                  │
│  ├── Spotify OAuth Tokens    │  ├── Spotify OAuth Tokens    │
│  ├── Last.fm API Keys        │  ├── Last.fm API Keys        │
│  ├── AI Provider Keys        │  ├── AI Provider Keys        │
│  ├── Uploaded JSON/CSVs      │  ├── Uploaded JSON/CSVs      │
│  └── Exclude/Archive DB      │  └── Exclude/Archive DB      │
└──────────────────────────────┴──────────────────────────────┘
```

### 5.1 Admin Features & User Isolation
1. **Initial Boot:** First launch prompts for initial Admin account creation.
2. **User Management:** Admin creates/manages local user accounts (Username / Password). Public signups are disabled.
3. **Data Security:** Passwords hashed with `argon2` or `bcrypt`. API keys and OAuth tokens encrypted at rest in SQLite. User upload files stored separately under `/data/uploads/{user_id}/`.

---

## 6. UI/UX Specification: Linear Single-Page Workflow

The interface is a **strictly linear, vertical-scrolling single page** with no modal popups or hidden drawer menus. All options and inline documentation remain visible.

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER: PDE Status & User Profile Switcher / Admin Link      │
├─────────────────────────────────────────────────────────────┤
│ STEP 1: Login & Music Connections (Tier Indicators Included) │
│   ├── User Login Form (Username / Password)                 │
│   ├── Spotify Connection Pathway (Free & Premium Options)   │
│   └── Last.fm Connection Pathway (Free & Pro Options)       │
├─────────────────────────────────────────────────────────────┤
│ STEP 2: AI Provider Setup (BYOK)                            │
│   ├── Provider Select (OpenAI, Anthropic, Gemini, OpenRouter)│
│   ├── API Key Input (Masked) & Model Selection              │
│   └── Rate Limit / Request Delay Slider                     │
├─────────────────────────────────────────────────────────────┤
│ STEP 3: Discovery Tuning & Preferences                      │
│   ├── Output Mode: Full Albums vs. Individual Tracks        │
│   ├── Obscurity Slider (Mainstream <----------> Niche)      │
│   └── Recommendation Quantity Limit                         │
├─────────────────────────────────────────────────────────────┤
│ STEP 4: Execution & Automation Controls                     │
│   ├── Schedule Settings (Off / Weekly / Monthly)            │
│   └── [ GENERATE DISCOVERY PLAYLIST NOW ] (Primary Action)  │
├─────────────────────────────────────────────────────────────┤
│ STEP 5: Live Progress Log & Playlist Sync Results           │
│   ├── Real-time Terminal Log (Parsing -> LLM -> Spotify)    │
│   └── Direct Link to Spotify Playlist & Track List Display  │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Music Ingestion & Tier Breakdown

To ensure users understand what features work with their Spotify or Last.fm account tiers, Step 1 provides clear visual cards comparing features, costs, and manual upload fallbacks.

### 7.1 Spotify Ingestion Pathways

| Feature | Spotify Free Account | Spotify Premium Account | Requirements & Notes |
|---|---|---|---|
| **Top Artists & Tracks API** | Supported (`short`, `medium`, `long` term) | Supported (`short`, `medium`, `long` term) | **100% Free.** Uses Spotify Web API via OAuth PKCE. |
| **Recently Played Tracks** | Last 50 plays supported | Last 50 plays supported | **100% Free.** Uses Spotify Web API. |
| **Full Lifetime History** | Supported via Manual JSON Upload | Supported via Manual JSON Upload | Requires requesting "Extended Streaming History" zip from Spotify settings. |
| **Playlist Generation** | Supported (Web/App streaming has ads) | Supported (Ad-free streaming) | Web API can write playlists for both Free & Premium accounts. |

#### UI Instructions Embedded in Step 1 (Spotify Manual JSON Export):
> **How to get your complete lifetime Spotify history (Free & Premium):**
> 1. Log into your account at [spotify.com/account/privacy](https://www.spotify.com/account/privacy).
> 2. Scroll to the **"Download your data"** section.
> 3. Check **"Extended streaming history"** (do NOT just select Account Data, as that only gives recent history).
> 4. Click **Request Data**. *Spotify will email you a link within 1–5 days.*
> 5. Download the `.zip` file, extract it, and drop all `endsong_*.json` or `Streaming_History_*.json` files into the drag-and-drop box below.

---

### 7.2 Last.fm Ingestion Pathways

| Feature | Last.fm Free Account | Last.fm Pro Account ($3/mo) | Requirements & Notes |
|---|---|---|---|
| **Full Scrobble History API** | Supported (Unlimited history via API) | Supported (Unlimited history via API) | **100% Free.** Requires entering Last.fm username + free API key or public fetch. |
| **Native CSV Export** | Not supported natively | Supported natively in account settings | Paid Last.fm Pro users can download raw CSVs directly from Last.fm settings. |
| **Free CSV Export Fallback** | Supported via open-source tools | Supported via open-source tools | **100% Free.** Uses web utilities like *Last.fm Scrobble Exporter* to generate CSVs. |

#### UI Instructions Embedded in Step 1 (Last.fm Connections & CSV Exports):
> **Option A: Automated API (Recommended - 100% Free)**  
> Enter your Last.fm username. PDE will fetch your complete top artists and scrobble history using Last.fm’s free public API endpoints.
> 
> **Option B: Manual CSV Upload (Free Tool or Last.fm Pro)**  
> * **Last.fm Pro Users:** Go to `Last.fm Settings -> Data -> Export Scrobbles` and upload your `.csv` file.
> * **Free Last.fm Users:** Use the free open-source tool [Last.fm Scrobble Exporter](https://mainro.github.io/lastfm-to-csv/), enter your username, click Export to CSV, and drop the resulting file below.

---

### 7.3 Unified Data Normalization & Exclusion Indexing
```typescript
interface UserListeningProfile {
  userId: string;
  topArtists: { name: string; playCount: number; weight: number }[];
  coreGenres: string[];
  knownArtistsSet: Set<string>; // Merged absolute set of all historical artists
}
```
* **Absolute Known Artist Exclusion:** Every artist identified across automated API pulls or uploaded JSON/CSV files is merged into `knownArtistsSet` so the LLM is explicitly forbidden from recommending them.

---

## 8. AI Provider Setup (BYOK) & Rate Limiting

### 8.1 Provider & Key Management
* Supports **OpenAI**, **Anthropic**, **Google Gemini**, and **OpenRouter**.
* Keys are input in Step 2, encrypted at rest in SQLite, and stored per user.

### 8.2 Rate-Limit Controls & Model Guidance
* **Request Delay Slider:** 0ms to 5000ms adjustable delay to protect against free-tier rate limits.
* **Model Selection Card:**
  * *High Accuracy & Deep Niche:* `claude-3-5-sonnet`, `gpt-4o`
  * *Budget & Large Context (Recommended for large exports):* `gemini-1.5-flash`, `gemini-1.5-pro`

---

## 9. Discovery Tuning & System Prompt Architecture

### 9.1 Tuning Sliders
* **Format:** `Full Albums` vs. `Individual Tracks`.
* **Obscurity Level (1–5):** `1` = Mainstream/adjacent; `3` = Critically acclaimed indie; `5` = Underground/Bandcamp niche.
* **Output Limit:** 5 to 20 (Albums) or 10 to 50 (Tracks).

### 9.2 System Prompt Specification
```text
You are an expert music curator and deep-crate collector. 
Analyze the user's historical listening profile below and recommend NEW music.

CRITICAL CONSTRAINTS:
1. DO NOT recommend any artist listed under EXCLUDED ARTISTS.
2. Ignore recency bias; focus on overall long-term taste patterns.
3. Obscurity Target: Level {OBSCURITY_LEVEL} (1=Mainstream, 5=Underground Niche).
4. Output MUST be valid JSON matching the requested schema.

USER LISTENING PROFILE:
- Top Artists & Weights: {TOP_ARTISTS_WEIGHTED_LIST}
- Core Genres/Styles: {CORE_GENRES}

EXCLUDED ARTISTS (STRICTLY FORBIDDEN):
{EXCLUSION_LIST}

OUTPUT FORMAT:
Generate {QUANTITY} {FORMAT_TYPE} recommendations. Return JSON only:
{
  "recommendations": [
    {
      "artist": "Artist Name",
      "title": "Album or Track Title",
      "reasoning": "Brief explanation connecting to user taste",
      "genre_tags": ["Tag1", "Tag2"]
    }
  ]
}
```

---

## 10. Spotify Playlist Synchronization & Archival System

PDE maintains exactly **two playlists** in the user's Spotify account to prevent clutter:
1. `Discovery Engine - Current` (Contains only the latest generation run).
2. `Discovery Engine - Archive` (Contains all historical recommendations concatenated).

```
                     ┌──────────────────────────────┐
                     │     User Triggers Run        │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │ 1. Read existing tracks from "Discovery Engine - Current" │
      └─────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │ 2. Append all existing tracks to                          │
      │    "Discovery Engine - Archive" (No duplicates)          │
      └─────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │ 3. Resolve LLM JSON output to Spotify Track URIs via      │
      │    Spotify Search API (/v1/search)                        │
      └─────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │ 4. Overwrite "Discovery Engine - Current" with new items  │
      └─────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │ 5. Store newly recommended items in user's local          │
      │    SQLite Exclusion Database for future runs              │
      └─────────────────────────────┬─────────────────────────────┘
```

---

## 11. Automation & Execution Modes

* **Manual Execution:** Click `[ GENERATE DISCOVERY PLAYLIST NOW ]` at the bottom of the single page.
* **Scheduled Execution:** Optional background task (`node-cron`) running on a user-defined schedule (e.g., Weekly on Mondays at 06:00 UTC, or Monthly).

---

## 12. Anti-Gravity Implementation Directives

> **Instructions for Anti-Gravity Autonomous Code Generation:**
> 1. **Project Setup:** Scaffold a Next.js / TypeScript application with SQLite (Prisma/Drizzle) containerized for Docker/Unraid.
> 2. **Auth & Multi-Tenancy:** Implement local authentication with Admin user creation and password-protected user data isolation.
> 3. **Single-Page UI:** Build a responsive, single-page Tailwind CSS layout with zero popup modals. Implement Theme Option 1 (Analog Hi-Fi) as the default style. Integrate clear Free vs. Premium indicators and step-by-step export guides for Spotify and Last.fm in Step 1.
> 4. **Ingestion & Parsers:** Build API integrations for Spotify OAuth PKCE and Last.fm API, alongside file upload parsers for Spotify `endsong.json` and Last.fm CSV scrobble exports.
> 5. **LLM Engine:** Implement BYOK support for OpenAI, Anthropic, Gemini, and OpenRouter with rate-limit delays.
> 6. **Playlist Archival:** Build the Spotify Search Resolver and dual-playlist rotation (`Current` -> `Archive`).
> 7. **CI/CD & Unraid Template:** Include `.github/workflows/deploy-unraid-template.yml`. *Query the user's reference GitHub repository to mirror their existing Unraid XML template release workflow.*
