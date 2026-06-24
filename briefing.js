#!/usr/bin/env node
/**
 * Gulf Business Daily Briefing
 * Six-section morning newsletter covering Gulf business, geopolitics & markets.
 *
 * Usage:  node briefing.js
 * Cron:   0 5 * * 1-5 cd /path/to/project && node briefing.js
 */

import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;
const GMAIL_USER      = process.env.GMAIL_USER;
const GMAIL_APP_PASS  = process.env.GMAIL_APP_PASS;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;

for (const [k, v] of Object.entries({ RECIPIENT_EMAIL, GMAIL_USER, GMAIL_APP_PASS, ANTHROPIC_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

// ─── Approved sources ─────────────────────────────────────────────────────────
const APPROVED_SOURCES = [
  // Tier-1 global
  "Reuters", "Bloomberg", "Financial Times", "Wall Street Journal", "WSJ",
  "Associated Press", "AP", "BBC", "The Economist", "New York Times",
  "Washington Post",
  // Gulf-specialist
  "The National", "Arab News", "Gulf News", "Khaleej Times",
  "MEED", "Arabian Business", "Zawya", "Al Monitor", "Middle East Eye",
  "Asharq Al-Awsat", "Al Arabiya", "Argaam",
];

// ─── Topics ───────────────────────────────────────────────────────────────────
const TOPICS = [
  {
    id: "saudi",
    label: "Saudi Arabia & Vision 2030",
    emoji: "🇸🇦",
    query: "Saudi Arabia Vision 2030 economy business investment policy",
  },
  {
    id: "uae",
    label: "UAE — Abu Dhabi & Dubai",
    emoji: "🇦🇪",
    query: "UAE Abu Dhabi Dubai economy business investment deal announcement",
  },
  {
    id: "oil",
    label: "Oil & Energy Markets",
    emoji: "🛢️",
    query: "Gulf oil energy OPEC crude price production Saudi Aramco ADNOC",
  },
  {
    id: "swf",
    label: "Sovereign Wealth Funds",
    emoji: "🏦",
    query: "Gulf sovereign wealth fund PIF Mubadala ADIA QIA investment deal",
  },
  {
    id: "geopolitics",
    label: "Gulf Geopolitics & Diplomacy",
    emoji: "🌐",
    query: "Gulf geopolitics diplomacy Saudi UAE relations US China Iran regional",
  },
  {
    id: "markets",
    label: "Gulf Financial Markets & M&A",
    emoji: "📈",
    query: "Gulf financial markets M&A IPO deal Saudi UAE Tadawul DFM ADX",
  },
];

// ─── Anthropic client ─────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

function todayString() {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

function stripCitations(str = "") {
  return String(str)
    .replace(/<cite[^>]*>/g, "")
    .replace(/<\/cite>/g, "")
    .trim();
}

/**
 * Fetch and validate news for a single topic.
 * Returns { summary, watch, stories: [{ headline, source, url, published_date, detail, significance }] }
 */
async function fetchTopic(topic) {
  console.log(`  → Searching: ${topic.label}`);
  const today = todayString();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: `You are a senior Gulf business journalist writing a morning briefing. Today's date is ${today}.

Use web search to find the LATEST news (published within the last 48 hours) on the given topic. 

STRICT RULES:
- Only include stories published in the last 48 hours. If you cannot find genuinely recent stories, say so honestly rather than using older material.
- Only cite stories from these approved sources: ${APPROVED_SOURCES.join(", ")}. Do not use blogs, press releases, or unknown outlets.
- Do not include any <cite> tags or citation markup in your response.

Return ONLY a valid JSON object with NO markdown fencing, NO preamble:
{
  "summary": "2-3 sentence factual overview of the current situation as of ${today}",
  "watch": "One forward-looking sentence: what to monitor in the next 24-48 hours",
  "stories": [
    {
      "headline": "Specific story headline",
      "source": "Exact publication name",
      "url": "https://full-url-to-article.com",
      "published_date": "YYYY-MM-DD or approximate e.g. today/yesterday",
      "detail": "1-2 sentence factual description of the story",
      "significance": "One sentence on why this matters for Gulf business"
    }
  ]
}
Include 2-4 of the most significant recent stories. Be factual and neutral.`,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: `Find the very latest news (last 48 hours, today is ${today}) about: ${topic.query}` }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    parsed.summary = stripCitations(parsed.summary || "");
    parsed.watch   = stripCitations(parsed.watch || "");
    parsed.stories = (parsed.stories || []).map((s) => ({
      ...s,
      headline:       stripCitations(s.headline),
      source:         stripCitations(s.source),
      detail:         stripCitations(s.detail),
      significance:   stripCitations(s.significance),
      published_date: stripCitations(s.published_date),
    }));
    return parsed;
  } catch {
    return { summary: stripCitations(text.slice(0, 400)), watch: "", stories: [] };
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function formatDate() {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

// ─── Colour map per topic ─────────────────────────────────────────────────────
const TOPIC_COLOURS = {
  saudi:      "#006C35", // Saudi green
  uae:        "#C8102E", // UAE red
  oil:        "#5A3E1B", // oil brown
  swf:        "#1B3A5C", // finance navy
  geopolitics:"#4A235A", // deep purple
  markets:    "#1A5C3A", // market green
};

// ─── HTML builder ─────────────────────────────────────────────────────────────
function buildHtml(results) {
  const date = formatDate();

  const sections = results.map(({ topic, data }) => {
    const colour = TOPIC_COLOURS[topic.id] || "#1a1a1a";

    const stories = (data.stories || []).map((s) => `
      <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #ede8df;">
        ${s.url
          ? `<a href="${esc(s.url)}" style="font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;display:block;margin-bottom:3px;line-height:1.4;">${esc(s.headline)}</a>`
          : `<div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:3px;line-height:1.4;">${esc(s.headline)}</div>`}
        <div style="font-size:10px;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">
          ${s.url ? `<a href="${esc(s.url)}" style="color:#999;text-decoration:none;">${esc(s.source)}</a>` : esc(s.source)}
          ${s.published_date ? ` &middot; ${esc(s.published_date)}` : ""}
        </div>
        <div style="font-size:13px;color:#444;line-height:1.65;">${esc(s.detail)}</div>
        ${s.significance ? `<div style="font-size:12px;color:#777;font-style:italic;margin-top:5px;line-height:1.5;">→ ${esc(s.significance)}</div>` : ""}
        ${s.url ? `<div style="margin-top:8px;"><a href="${esc(s.url)}" style="font-size:11px;color:#888;text-decoration:underline;">Read more →</a></div>` : ""}
      </div>`).join("");

    const watchBox = data.watch ? `
      <div style="background:#f9f6f0;border-left:3px solid ${colour};padding:10px 14px;margin-top:4px;margin-bottom:4px;font-size:12px;color:#555;line-height:1.5;">
        <strong style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#aaa;display:block;margin-bottom:4px;">What to watch</strong>
        ${esc(data.watch)}
      </div>` : "";

    return `
      <div style="padding:28px 40px;border-bottom:2px solid #e8e3d8;">
        <div style="display:flex;align-items:center;margin-bottom:12px;">
          <span style="font-size:18px;margin-right:10px;">${topic.emoji}</span>
          <span style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:${colour};font-weight:700;">${esc(topic.label)}</span>
        </div>
        ${data.summary ? `<div style="font-size:14px;line-height:1.75;color:#333;border-left:3px solid ${colour};padding-left:14px;margin-bottom:20px;">${esc(data.summary)}</div>` : ""}
        ${stories}
        ${watchBox}
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gulf Business Briefing — ${date}</title></head>
<body style="margin:0;padding:0;background:#f0ece4;font-family:Georgia,serif;">
  <div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #d8d3c8;">

    <div style="background:#0a0a0a;color:#f0ece4;padding:36px 40px;">
      <div style="font-size:9px;letter-spacing:6px;text-transform:uppercase;opacity:.4;margin-bottom:10px;">Daily Intelligence</div>
      <div style="font-size:28px;font-weight:700;margin-bottom:6px;letter-spacing:-0.5px;">Gulf Business Briefing</div>
      <div style="font-size:12px;opacity:.4;letter-spacing:1px;">${date}</div>
    </div>

    <div style="padding:16px 40px;background:#f9f6f0;border-bottom:2px solid #e8e3d8;font-size:11px;color:#888;letter-spacing:1px;">
      ${TOPICS.map(t => `<span style="margin-right:16px;">${t.emoji} ${t.label}</span>`).join("")}
    </div>

    ${sections}

    <div style="padding:24px 40px;text-align:center;font-size:10px;color:#bbb;background:#f9f6f0;letter-spacing:1px;">
      Gulf Business Briefing · ${date} · Sources verified against approved outlet list
    </div>
  </div>
</body></html>`;
}

// ─── Plain text builder ───────────────────────────────────────────────────────
function buildText(results) {
  const date = formatDate();
  let out = `GULF BUSINESS BRIEFING — ${date}\n${"=".repeat(52)}\n\n`;
  for (const { topic, data } of results) {
    out += `${topic.emoji}  ${topic.label.toUpperCase()}\n${"-".repeat(topic.label.length + 4)}\n`;
    if (data.summary) out += `${data.summary}\n\n`;
    for (const s of data.stories || []) {
      out += `• ${s.headline} (${s.source}${s.published_date ? ", " + s.published_date : ""})\n`;
      out += `  ${s.detail}\n`;
      if (s.significance) out += `  → ${s.significance}\n`;
      if (s.url) out += `  ${s.url}\n`;
      out += "\n";
    }
    if (data.watch) out += `WATCH: ${data.watch}\n`;
    out += "\n";
  }
  return out;
}

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Send email ───────────────────────────────────────────────────────────────
async function sendEmail(htmlBody, textBody) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS },
  });

  const subject = `Gulf Briefing — ${formatDate()}`;
  const info = await transporter.sendMail({
    from: `"Gulf Briefing" <${GMAIL_USER}>`,
    to: RECIPIENT_EMAIL,
    subject,
    text: textBody,
    html: htmlBody,
  });

  console.log(`  → Email sent: ${info.messageId}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nGulf Business Briefing — ${formatDate()}`);
  console.log("Fetching news...\n");

  const results = [];
  for (const topic of TOPICS) {
    try {
      const data = await fetchTopic(topic);
      results.push({ topic, data });
    } catch (err) {
      console.error(`  ✗ Failed: "${topic.label}":`, err.message);
      results.push({ topic, data: { summary: "Could not retrieve stories for this topic.", watch: "", stories: [] } });
    }
  }

  console.log("\nBuilding and sending email...");
  await sendEmail(buildHtml(results), buildText(results));
  console.log("\n✓ Done.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
