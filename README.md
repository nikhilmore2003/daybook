# Daybook

A personal daily tracker: habits with streaks, mood / energy / productivity check-ins, sleep, a journal, a time log, a job-application pipeline, and a 30-day insights page with CSV export.

Built with plain HTML/CSS/JavaScript, **Supabase** (Postgres database + login), and installable on iPhone and laptop as a **PWA**. Hosted free on **GitHub Pages**.

---

## Setup (about 45 minutes, one time)

### Step 1: Create the Supabase project (the database)

1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. Click **New project**.
   - Name: `daybook`
   - Database password: click **Generate**, then save it somewhere safe.
   - Region: **Mumbai (ap-south-1)**, closest to you.
   - Plan: **Free**.
3. Wait 1–2 minutes for the project to finish creating.
4. In the left sidebar, open **SQL Editor** → **New query**.
5. Open `supabase/schema.sql` from this folder, copy all of it, paste it in, and click **Run**. You should see "Success. No rows returned".
6. Check it worked: open **Table Editor**. You should see a table called `entries`, with "RLS enabled" shown on it.

### Step 2: Connect the app to Supabase

1. In Supabase, open **Project Settings** (gear icon) → **API** (it may be under **API Keys** / **Data API**).
2. Copy the **Project URL** (looks like `https://abcdxyz.supabase.co`).
3. Copy the **anon public** key (or the **publishable** key on newer projects).
   ⚠️ Do **not** use the `service_role` / `secret` key. That one must never go in a website.
4. Open `config.js` in this folder in any text editor (VS Code or Notepad) and paste both values:
   ```js
   window.DAYBOOK_CONFIG = {
     SUPABASE_URL: "https://abcdxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi..."
   };
   ```
5. Save the file.

> Is it safe that this key is public? Yes. The anon key only lets people do what Row Level Security allows, and `schema.sql` makes every user able to read and write **only their own rows**.

### Step 3: Put the code on GitHub

**Option A: no Git commands needed (easiest)**

1. Go to **github.com** → **+** (top right) → **New repository**.
2. Name: `daybook`. Choose **Public** (GitHub Pages is free for public repos). Tick **Add a README file**. Click **Create repository**.
3. In the new repo, click **Add file** → **Upload files**.
4. Drag in **everything inside** this folder: `index.html`, `config.js`, `sw.js`, `manifest.webmanifest`, `README.md`, and the `icons` and `supabase` folders. Upload the files themselves, not the outer `daybook` folder. When asked, replace the existing README.
5. Click **Commit changes**.

**Option B: with Git (if you have it installed)**

```bash
cd path/to/daybook
git init
git add .
git commit -m "Daybook: habit, mood, time and job tracker"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/daybook.git
git push -u origin main
```

### Step 4: Turn on GitHub Pages (make it live)

1. In your repo, go to **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait 1–2 minutes and refresh. GitHub shows your live link:
   `https://YOUR-USERNAME.github.io/daybook/`

### Step 5: Tell Supabase your website address

This makes the "confirm your email" link come back to your site.

1. In Supabase, open **Authentication** → **URL Configuration**.
2. **Site URL**: `https://YOUR-USERNAME.github.io/daybook/`
3. Under **Redirect URLs**, click **Add URL** and add the same address.
4. Save.

*(Optional, to skip email confirmation: **Authentication** → **Sign In / Providers** → **Email** → turn off **Confirm email**. Fine for a personal app.)*

### Step 6: Create your account

1. Open your live link on your laptop.
2. Click **New here? Create an account**, then enter your email and a password.
3. If email confirmation is on, open the email from Supabase, tap the link, then come back and **Sign in**.

### Step 7: Install it

**iPhone**
1. Open your link in **Safari** (it has to be Safari).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open Daybook from the home-screen icon and sign in once. It opens full-screen like an app.

**Laptop (Chrome or Edge)**
1. Open your link.
2. Click the **install icon** at the right end of the address bar (or menu ⋮ → **Cast, save and share** → **Install page as app**).
3. It gets its own window and an icon in your Start menu or dock.

Everything you log syncs between devices through your Supabase account.

### Step 8: Bring over data from the Claude version (optional)

1. In the Claude version of Daybook: **Insights** → **Export** → download both CSVs.
2. In your new app: **Account** tab → **Import** → choose each CSV.

---

## How it works

| Part | What it does |
|---|---|
| `index.html` | The whole app: layout, styles, and logic |
| `config.js` | Your Supabase URL and public key |
| `sw.js` | Service worker: caches the app so it opens offline |
| `manifest.webmanifest` | App name, icon and colours for installing |
| `supabase/schema.sql` | Database table plus Row Level Security policies |

**Data model.** One Postgres table, `entries(user_id, key, data jsonb)`:
- `settings` holds the habit list
- `jobs` holds all job applications
- `d-YYYY-MM-DD` holds one day: habits ticked, mood, energy, productivity, sleep, journal, time blocks

**Offline first.** Every change saves to the device instantly (localStorage), then syncs to Supabase. With no internet, the status shows "Offline · will sync", and changes upload when you reconnect. When you switch back to the app, it pulls the latest from your other devices.

**Query your own data with SQL** (Supabase → SQL Editor):
```sql
select key as day,
       (data->>'mood')::int    as mood,
       (data->>'prod')::int    as productivity,
       (data->>'sleep')::numeric as sleep_hours
from entries
where key like 'd-%'
order by key;
```

---

## Updating the app later

1. Edit the files (for example, change something in `index.html`).
2. In `sw.js`, bump `VERSION` (for example, `daybook-v1` → `daybook-v2`) so phones fetch the new version.
3. Upload the changed files to GitHub (**Add file** → **Upload files**) or `git push`.
4. GitHub Pages updates in about a minute. On iPhone, close and reopen the app, twice if needed.

## Troubleshooting

- **"Daybook isn't connected to a database yet"**: `config.js` still has the placeholder values, or it wasn't uploaded.
- **"Wrong email or password"**: if you just signed up, confirm your email first (Step 6), or turn off confirmation (Step 5, optional).
- **The confirmation email link opens a localhost page**: set the Site URL (Step 5).
- **Changes don't show on the other device**: switch away from the app and back, or use **Account → Sync now**.
- **404 on the live link**: wait 2 minutes after enabling Pages, and check that `index.html` is in the repo root, not inside a folder.
- **Supabase pauses free projects after about a week with no activity.** If the app suddenly can't sync, open the Supabase dashboard and click **Restore project**. Using the app daily keeps it active.

## Resume line

> **Daybook: Personal Analytics PWA** · JavaScript, Supabase (PostgreSQL, Row Level Security), PWA
> Built an offline-first tracker for habits, mood, time and job applications that syncs across devices; added a 30-day insights engine (streaks, sleep–productivity correlation, application funnel) and CSV export for analysis in Pandas and Power BI.
