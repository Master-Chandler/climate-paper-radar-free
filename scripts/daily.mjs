import { readFile, writeFile } from "node:fs/promises";
import { connect as tlsConnect } from "node:tls";

const profile = JSON.parse(await readFile(new URL("../config/profile.json", import.meta.url)));
const dataUrl = new URL("../data/recommendations.json", import.meta.url);
const previous = JSON.parse(await readFile(dataUrl));
const now = new Date();
const climateKeywords = [
  "climate", "atmospher", "ocean", "monsoon", "precipitation", "temperature",
  "sea ice", "ice sheet", "hydrolog", "weather", "circulation", "teleconnection",
  "radiation", "heatwave", "drought", "rainfall", "snow", "cryosphere"
];
const physicalClimateKeywords = climateKeywords.filter(keyword => !["climate", "teleconnection"].includes(keyword));
const stemKeywords = new Set(["atmospher", "hydrolog", "snow"]);
const from = new Date(now);
from.setUTCDate(from.getUTCDate() - profile.lookbackDays);
const fromDate = from.toISOString().slice(0, 10);
const toDate = now.toISOString().slice(0, 10);

const results = [];
const failedTopicIds = new Set();

for (const [index, topic] of profile.topics.entries()) {
  try {
    results.push(...await fetchTopic(topic));
    console.log(`OpenAlex topic complete: ${topic.label}`);
  } catch (error) {
    failedTopicIds.add(topic.id);
    console.warn(`OpenAlex topic skipped after retries: ${topic.label} — ${error.message}`);
  }
  if (index < profile.topics.length - 1) await sleep(1200);
}

if (results.length === 0) {
  console.warn("OpenAlex is temporarily unavailable. Keeping the previous recommendations unchanged.");
} else {
  const rankedPapers = dedupe(results)
    .map(scorePaper)
    .filter(paper => paper.score >= profile.minimumScore && paper.abstractEn);
  const retainedPapers = previous.papers.filter(paper => failedTopicIds.has(paper.topic));
  const papers = dedupePapers([...rankedPapers, ...retainedPapers])
    .sort((a, b) => b.score - a.score)
    .slice(0, profile.maxRecommendations);

  const previousIds = new Set(previous.papers.map(paper => paper.id));
  const output = {
    generatedAt: now.toISOString(),
    source: "OpenAlex（免费 API Key）",
    profile: previous.profile,
    papers
  };
  await writeFile(dataUrl, `${JSON.stringify(output, null, 2)}\n`);

  const newPapers = papers.filter(paper => !previousIds.has(paper.id));
  if (newPapers.length && smtpConfigured()) {
    await sendDigest(newPapers);
  }
  console.log(
    `Updated ${papers.length} recommendations; ${newPapers.length} new; ${failedTopicIds.size} topic(s) retained.`
  );
}

async function fetchTopic(topic) {
  const params = new URLSearchParams({
    search: topic.query,
    filter: `from_publication_date:${fromDate},to_publication_date:${toDate},has_abstract:true,language:en`,
    sort: "publication_date:desc",
    "per-page": "30",
    select: "id,doi,title,display_name,publication_date,authorships,primary_location,abstract_inverted_index,cited_by_count,type"
  });
  if (process.env.OPENALEX_EMAIL) params.set("mailto", process.env.OPENALEX_EMAIL);
  if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
  const body = await fetchOpenAlexWithRetry(`https://api.openalex.org/works?${params}`, topic.label);
  return body.results.map(work => ({ work, matchedTopic: topic }));
}

async function fetchOpenAlexWithRetry(url, topicLabel, maxAttempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": `ClimatePaperRadar/2.1 (${process.env.OPENALEX_EMAIL || "no-email"})` },
        signal: AbortSignal.timeout(30_000)
      });
      if (response.ok) return await response.json();

      const body = await response.text();
      const retryable = [403, 408, 425, 429, 500, 502, 503, 504].includes(response.status);
      lastError = new Error(`OpenAlex ${response.status}: ${body.slice(0, 300)}`);
      if (!retryable || attempt === maxAttempts - 1) throw lastError;

      const waitMs = retryDelay(response.headers.get("retry-after"), attempt);
      console.warn(
        `OpenAlex ${response.status} for ${topicLabel}; retry ${attempt + 2}/${maxAttempts} in ${Math.ceil(waitMs / 1000)}s.`
      );
      await sleep(waitMs);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw lastError;
      const waitMs = 3000 * (2 ** attempt);
      console.warn(
        `OpenAlex request error for ${topicLabel}; retry ${attempt + 2}/${maxAttempts} in ${Math.ceil(waitMs / 1000)}s.`
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function retryDelay(retryAfter, attempt) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(3000 * (3 ** attempt) + Math.floor(Math.random() * 1000), 30_000);
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function dedupe(items) {
  const map = new Map();
  for (const item of items) {
    const id = item.work.id;
    const current = map.get(id);
    if (!current || item.matchedTopic.weight > current.matchedTopic.weight) map.set(id, item);
  }
  return [...map.values()];
}

function dedupePapers(papers) {
  return [...new Map(papers.map(paper => [paper.id, paper])).values()];
}

function scorePaper({ work, matchedTopic }) {
  const abstractEn = reconstruct(work.abstract_inverted_index);
  const text = `${work.title} ${abstractEn}`.toLowerCase();
  const allMatches = [...new Set(profile.topics.flatMap(topic => topic.keywords))]
    .filter(keyword => containsKeyword(text, keyword));
  const topicMatches = matchedTopic.keywords.filter(keyword => containsKeyword(text, keyword));
  const climateMatches = climateKeywords.filter(keyword => containsKeyword(text, keyword));
  const physicalClimateMatches = physicalClimateKeywords.filter(keyword => containsKeyword(text, keyword));
  const requiredMatches = (matchedTopic.requiredKeywords || []).filter(keyword => containsKeyword(text, keyword));
  const requiredTopicMatch = !matchedTopic.requiredKeywords || requiredMatches.length > 0;
  const ageDays = Math.max(0, (now - new Date(`${work.publication_date}T00:00:00Z`)) / 86400000);
  const freshness = Math.max(0, 18 - ageDays * 1.2);
  const quality = Math.min(10, Math.log2((work.cited_by_count || 0) + 1) * 2.5);
  const crossTopicMatches = Math.max(0, allMatches.length - topicMatches.length);
  const relevance = Math.min(
    62,
    20 + topicMatches.length * 9 + Math.min(3, crossTopicMatches) * 4 + Math.min(3, climateMatches.length) * 3
  );
  const score = topicMatches.length && climateMatches.length && physicalClimateMatches.length && requiredTopicMatch
    ? Math.min(99, Math.round((relevance + freshness + quality) * matchedTopic.weight))
    : 0;
  return {
    id: work.id.split("/").pop(),
    title: work.display_name || work.title,
    authors: work.authorships.slice(0, 8).map(item => item.author.display_name),
    journal: work.primary_location?.source?.display_name || "Preprint / Unknown source",
    publicationDate: work.publication_date,
    doi: work.doi,
    openAlexUrl: work.id,
    topic: matchedTopic.id,
    topicLabel: matchedTopic.label,
    score,
    matchedKeywords: allMatches.slice(0, 8),
    whyRelevantZh: buildReason(matchedTopic.label, topicMatches, climateMatches),
    abstractEn
  };
}

function reconstruct(index) {
  if (!index) return "";
  return Object.entries(index)
    .flatMap(([word, positions]) => positions.map(position => [position, word]))
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(" ");
}

function containsKeyword(text, keyword) {
  if (stemKeywords.has(keyword)) return text.includes(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function buildReason(topicLabel, topicMatches, climateMatches) {
  const terms = [...new Set([...topicMatches, ...climateMatches])].slice(0, 5).join("、");
  return `归入“${topicLabel}”：标题或摘要命中 ${terms}，并通过气候领域与主题关键词双重筛选。`;
}

function smtpConfigured() {
  return ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "DIGEST_TO_EMAIL"]
    .every(name => Boolean(process.env[name]));
}

async function sendDigest(newPapers) {
  const html = digestHtml(newPapers);
  const subject = `Paper Radar｜${newPapers.length} 篇与你相关的新论文`;
  await sendSmtpMail({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASS,
    to: process.env.DIGEST_TO_EMAIL,
    subject,
    html
  });
  console.log(`Free SMTP digest sent to ${maskEmail(process.env.DIGEST_TO_EMAIL)}.`);
}

function digestHtml(papers) {
  const cards = papers.map(paper => `
    <article style="padding:20px 0;border-bottom:1px solid #e5e7e5">
      <div style="color:#1b644c;font-size:12px">${escapeHtml(paper.topicLabel)} · 相关度 ${paper.score}%</div>
      <h2 style="font-size:18px;line-height:1.5;margin:8px 0">${escapeHtml(paper.title)}</h2>
      <div style="color:#718078;font-size:12px">${escapeHtml(paper.journal)} · ${paper.publicationDate}</div>
      <p style="font-size:13px;line-height:1.75;color:#34463e">${escapeHtml(paper.abstractEn)}</p>
      <p style="font-size:12px;line-height:1.7"><b>推荐依据：</b>${escapeHtml(paper.whyRelevantZh)}</p>
      <a href="${paper.doi || paper.openAlexUrl}" style="color:#1b644c;font-weight:bold">阅读原文 →</a>
    </article>`).join("");
  return `<main style="max-width:680px;margin:auto;font-family:Arial,'PingFang SC',sans-serif;color:#17231f">
    <p style="letter-spacing:2px;color:#718078;font-size:11px">PERSONAL RESEARCH INTELLIGENCE</p>
    <h1>今日论文雷达</h1>
    <p>共发现 ${papers.length} 篇高相关新论文。本邮件由免费 OpenAlex + GitHub Actions + 邮箱 SMTP 生成。</p>
    ${cards}
    <p style="margin-top:30px;color:#8a958f;font-size:11px">摘要为作者英文摘要原文，不包含 AI 生成内容；请以论文全文为准。</p>
  </main>`;
}

async function sendSmtpMail({ host, port, user, password, to, subject, html }) {
  const socket = await openTlsSocket(host, port);
  await expectReply(socket, null, 220);
  await expectReply(socket, `EHLO paper-radar.local`, 250);
  await expectReply(socket, "AUTH LOGIN", 334);
  await expectReply(socket, Buffer.from(user).toString("base64"), 334);
  await expectReply(socket, Buffer.from(password).toString("base64"), 235);
  await expectReply(socket, `MAIL FROM:<${user}>`, 250);
  await expectReply(socket, `RCPT TO:<${to}>`, 250);
  await expectReply(socket, "DATA", 354);

  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const encodedHtml = wrapBase64(Buffer.from(html).toString("base64"));
  const message = [
    `From: Paper Radar <${user}>`,
    `To: <${to}>`,
    `Subject: ${encodedSubject}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodedHtml,
    "."
  ].join("\r\n");
  await expectReply(socket, message, 250);
  await expectReply(socket, "QUIT", 221);
  socket.end();
}

function openTlsSocket(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port, servername: host });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function expectReply(socket, command, expectedCode) {
  const replyPromise = readReply(socket);
  if (command !== null) socket.write(`${command}\r\n`);
  const reply = await replyPromise;
  if (reply.code !== expectedCode) {
    throw new Error(`SMTP expected ${expectedCode}, received ${reply.code}: ${reply.text}`);
  }
  return reply;
}

function readReply(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const final = lines.findLast(line => /^\d{3} /.test(line));
      if (!final) return;
      cleanup();
      resolve({ code: Number(final.slice(0, 3)), text: lines.join(" ") });
    };
    const onError = error => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("SMTP connection closed unexpectedly")); };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function wrapBase64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
  )[char]);
}

function maskEmail(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}
