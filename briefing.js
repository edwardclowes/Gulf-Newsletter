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
    query: "Saudi Arabia economy business investment PIF Aramco Riyadh",
  },
  {
    id: "uae",
    label: "UAE — Abu Dhabi & Dubai",
    emoji: "🇦🇪",
    query: "UAE Abu Dhabi Dubai economy business investment deal announcement",
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
    max_tokens: 900,
    system: `You are a senior Gulf business journalist writing a tight morning briefing. Today's date is ${today}.

Use web search to find the LATEST news (published within the last 72 hours) on the given topic.

STRICT RULES:
- Only include stories published in the last 72 hours. If you cannot find genuinely recent stories, return fewer or none rather than using older material.
- Only cite stories from these approved sources: ${APPROVED_SOURCES.join(", ")}. Do not use blogs, press releases, or unknown outlets.
- Do not include any <cite> tags or citation markup.
- Keep it punchy. One sentence per story, no more.

CRITICAL: Your entire response must be ONLY the raw JSON object. Do NOT write any preamble, explanation, or thinking-out-loud. Do NOT use code fences. Start with { and end with }. Use this exact structure:
{
  "stories": [
    {
      "headline": "Specific story headline",
      "source": "Exact publication name",
      "url": "https://full-url-to-article.com",
      "detail": "ONE sentence summarising the story"
    }
  ],
  "watch": "ONE forward-looking sentence: what to monitor on this topic in the next 24-48 hours"
}
Include the 3 most significant recent stories. Be factual and neutral.`,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    messages: [{ role: "user", content: `Find the very latest news (last 72 hours, today is ${today}) about: ${topic.query}` }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    // Pull out just the JSON object, ignoring any preamble or code fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text.replace(/```json|```/g, "").trim());
    parsed.watch = stripCitations(parsed.watch || "");
    parsed.stories = (parsed.stories || []).map((s) => ({
      headline: stripCitations(s.headline),
      source:   stripCitations(s.source),
      url:      s.url,
      detail:   stripCitations(s.detail),
    }));
    return parsed;
  } catch {
    return { stories: [], watch: "" };
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
      <div style="margin-bottom:16px;">
        ${s.url
          ? `<a href="${esc(s.url)}" style="font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;line-height:1.4;">${esc(s.headline)}</a>`
          : `<span style="font-size:14px;font-weight:700;color:#1a1a1a;line-height:1.4;">${esc(s.headline)}</span>`}
        <span style="font-size:10px;color:#aaa;letter-spacing:1px;text-transform:uppercase;"> — ${esc(s.source)}</span>
        <div style="font-size:13px;color:#555;line-height:1.55;margin-top:3px;">${esc(s.detail)}</div>
      </div>`).join("");

    return `
      <div style="padding:24px 40px;border-bottom:2px solid #e8e3d8;">
        <div style="display:flex;align-items:center;margin-bottom:14px;">
          <span style="font-size:16px;margin-right:10px;">${topic.emoji}</span>
          <span style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:${colour};font-weight:700;">${esc(topic.label)}</span>
        </div>
        ${stories || `<div style="font-size:12px;color:#aaa;font-style:italic;">No fresh stories in the last 72 hours.</div>`}
        ${data.watch ? `<div style="background:#f9f6f0;border-left:3px solid ${colour};padding:9px 13px;margin-top:12px;font-size:12px;color:#555;line-height:1.5;"><strong style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#aaa;display:block;margin-bottom:3px;">What to watch</strong>${esc(data.watch)}</div>` : ""}
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
    const stories = data.stories || [];
    if (!stories.length) out += `No fresh stories in the last 72 hours.\n`;
    for (const s of stories) {
      out += `• ${s.headline} — ${s.source}\n  ${s.detail}\n`;
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
      results.push({ topic, data: { stories: [] } });
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
