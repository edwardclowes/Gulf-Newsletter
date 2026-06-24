# Gulf Business Briefing

An automated morning newsletter that searches top-tier news sources for the latest Gulf business, energy, and geopolitical news, then emails a formatted briefing to your inbox each weekday before regional markets open.

Built with the Anthropic API (Claude + web search) and Gmail. Runs automatically and free via GitHub Actions.

---

## What it covers

Six sections, each refreshed daily:

| Section | Focus |
|---|---|
| 🇸🇦 Saudi Arabia & Vision 2030 | Economy, giga-projects, policy, investment |
| 🇦🇪 UAE — Abu Dhabi & Dubai | Business, deals, regulation, announcements |
| 🛢️ Oil & Energy Markets | OPEC, crude prices, Aramco, ADNOC, production |
| 🏦 Sovereign Wealth Funds | PIF, Mubadala, ADIA, QIA deal flow |
| 🌐 Gulf Geopolitics & Diplomacy | Regional relations, US/China/Iran dynamics |
| 📈 Gulf Financial Markets & M&A | IPOs, M&A, Tadawul, DFM, ADX |

Each section includes a short situation summary, 2–4 verified stories with source links and publication dates, and a forward-looking **"What to watch"** note.

---

## How it works

1. A scheduled GitHub Action runs the script each weekday morning.
2. For each section, Claude performs a live web search constrained to the **last 48 hours** and an **approved source list**.
3. Results are validated, formatted into an HTML email, and sent via Gmail.

### Source quality

Stories are drawn only from an approved outlet list combining tier-1 global and Gulf-specialist sources, including: Reuters, Bloomberg, Financial Times, Wall Street Journal, AP, BBC, The Economist, The National, Arab News, Gulf News, MEED, Arabian Business, Zawya, Al Monitor, and Asharq Al-Awsat.

### Timeliness

Today's date is passed into every search and the model is instructed to use only stories from the last 48 hours — or to say so honestly when recent material is unavailable. Each story carries its publication date so freshness is visible at a glance.

---

## Setup

### Requirements

| Requirement | Where to get it |
|---|---|
| Anthropic API key | https://console.anthropic.com |
| Gmail account | For sending the email |
| Gmail App Password | https://myaccount.google.com/apppasswords |

### Secrets

Add these under repo **Settings → Secrets and variables → Actions**:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key |
| `GMAIL_USER` | Sending Gmail address |
| `GMAIL_APP_PASS` | 16-character Gmail App Password |
| `RECIPIENT_EMAIL` | Where to deliver the briefing |

### Schedule

Delivery time is controlled by the cron expression in `.github/workflows/daily-briefing.yml`:

```yaml
- cron: "0 5 * * 1-5"   # 05:00 UTC weekdays = 06:00 UK, before Gulf markets open
```

GitHub Actions runs on UTC. Gulf markets (Tadawul, DFM, ADX) open around 10:00 GST (06:00 UTC), so a 05:00 UTC run delivers the briefing ahead of the open.

### Run manually

Trigger a test any time from the **Actions** tab → **Daily Gulf Briefing** → **Run workflow**.

---

## Customising

- **Topics:** edit the `TOPICS` array in `briefing.js`
- **Sources:** edit the `APPROVED_SOURCES` array in `briefing.js`
- **Delivery time:** edit the cron in `.github/workflows/daily-briefing.yml`
- **Recipients:** change the `RECIPIENT_EMAIL` secret (comma-separate for multiple)

---

## Cost

Roughly six web-search API calls per run, about £0.05–0.15 per day depending on result length — approximately £2–4/month. GitHub Actions is free for this usage level.
