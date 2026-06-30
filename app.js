const state = {
  papers: [],
  filter: "all",
  view: "all",
  query: "",
  saved: new Set(JSON.parse(localStorage.getItem("paper-radar-saved") || "[]"))
};

const els = {
  grid: document.querySelector("#paperGrid"),
  template: document.querySelector("#paperTemplate"),
  filters: document.querySelector("#filters"),
  sideTopics: document.querySelector("#sideTopics"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  feed: document.querySelector("#feedView"),
  settings: document.querySelector("#settingsView"),
  savedCount: document.querySelector("#savedCount")
};

const topicOrder = ["ai-climate", "east-asia", "tibetan-plateau", "polar", "teleconnection"];

async function load() {
  try {
    const response = await fetch("./data/recommendations.json", { cache: "no-store" });
    if (!response.ok) throw new Error("数据加载失败");
    const data = await response.json();
    state.papers = data.papers || [];
    buildTopics();
    updateMetrics(data.generatedAt);
    render();
  } catch (error) {
    els.grid.innerHTML = `<div class="empty-state"><h3>暂时无法加载论文</h3><p>${error.message}</p></div>`;
  }
}

function buildTopics() {
  const topics = [...new Map(state.papers.map(p => [p.topic, p.topicLabel])).entries()]
    .sort((a, b) => topicOrder.indexOf(a[0]) - topicOrder.indexOf(b[0]));
  els.filters.innerHTML = `<button class="filter-button active" data-filter="all">全部</button>` +
    topics.map(([id, label]) => `<button class="filter-button" data-filter="${id}">${label}</button>`).join("");
  els.sideTopics.innerHTML = topics.map(([id, label]) =>
    `<button class="topic-link" data-topic="${id}">${label}</button>`).join("");
}

function updateMetrics(generatedAt) {
  const count = state.papers.length;
  const average = count ? Math.round(state.papers.reduce((sum, p) => sum + p.score, 0) / count) : 0;
  document.querySelector("#heroCount").textContent = count;
  document.querySelector("#todayCount").textContent = count;
  document.querySelector("#averageScore").textContent = `${average}%`;
  document.querySelector("#summaryCount").textContent = state.papers.filter(p => p.abstractEn).length;
  const date = new Date(generatedAt);
  document.querySelector("#updateTime").textContent = Number.isNaN(date.getTime())
    ? "每日更新"
    : `${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date)}更新`;
  els.savedCount.textContent = state.saved.size;
}

function visiblePapers() {
  const q = state.query.trim().toLowerCase();
  return state.papers.filter(p => {
    const matchesView = state.view !== "saved" || state.saved.has(p.id);
    const matchesTopic = state.filter === "all" || p.topic === state.filter;
    const haystack = [p.title, p.journal, p.abstractEn, ...(p.authors || [])].join(" ").toLowerCase();
    return matchesView && matchesTopic && (!q || haystack.includes(q));
  });
}

function render() {
  if (state.view === "settings") {
    els.feed.hidden = true;
    els.settings.hidden = false;
    return;
  }
  els.feed.hidden = false;
  els.settings.hidden = true;
  const papers = visiblePapers();
  els.grid.innerHTML = "";
  for (const paper of papers) {
    const card = els.template.content.cloneNode(true);
    card.querySelector(".topic-pill").textContent = paper.topicLabel;
    card.querySelector(".paper-title").textContent = paper.title;
    card.querySelector(".paper-meta").innerHTML = `<strong>${paper.journal}</strong> · ${formatDate(paper.publicationDate)}`;
    card.querySelector(".score-row i").style.width = `${paper.score}%`;
    card.querySelector(".score-row strong").textContent = `${paper.score}%`;
    const summary = card.querySelector(".summary");
    summary.textContent = paper.abstractEn || "OpenAlex 暂未收录该论文摘要。";
    summary.lang = "en";
    card.querySelector(".method").textContent = (paper.matchedKeywords || []).join(" · ") || paper.topicLabel;
    card.querySelector(".relevance").textContent = paper.whyRelevantZh || `论文内容与“${paper.topicLabel}”主题及你的研究关键词存在较高重合。`;
    card.querySelector(".caveat").textContent = "以上为作者英文摘要原文，不包含 AI 生成或翻译内容；请以 DOI 页面和论文全文为准。";
    card.querySelector(".authors").textContent = (paper.authors || []).join(" · ");
    const link = card.querySelector(".read-link");
    link.href = paper.doi || paper.openAlexUrl;
    const save = card.querySelector(".save-button");
    save.dataset.id = paper.id;
    save.classList.toggle("saved", state.saved.has(paper.id));
    save.textContent = state.saved.has(paper.id) ? "♥" : "♡";
    save.setAttribute("aria-label", state.saved.has(paper.id) ? "取消收藏" : "收藏论文");
    els.grid.appendChild(card);
  }
  els.empty.hidden = papers.length > 0;
  document.querySelector("#resultCaption").textContent =
    state.view === "saved" ? `已收藏 ${papers.length} 篇论文` : `找到 ${papers.length} 篇，按相关度排序`;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

els.search.addEventListener("input", event => {
  state.query = event.target.value;
  render();
});

els.filters.addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  els.filters.querySelectorAll(".filter-button").forEach(el => el.classList.toggle("active", el === button));
  render();
});

els.sideTopics.addEventListener("click", event => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  state.view = "all";
  state.filter = button.dataset.topic;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === "all"));
  els.filters.querySelectorAll(".filter-button").forEach(el => el.classList.toggle("active", el.dataset.filter === state.filter));
  document.querySelector(".sidebar").classList.remove("open");
  render();
});

els.grid.addEventListener("click", event => {
  const button = event.target.closest(".save-button");
  if (!button) return;
  state.saved.has(button.dataset.id) ? state.saved.delete(button.dataset.id) : state.saved.add(button.dataset.id);
  localStorage.setItem("paper-radar-saved", JSON.stringify([...state.saved]));
  els.savedCount.textContent = state.saved.size;
  render();
});

document.querySelector("nav").addEventListener("click", event => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  state.filter = "all";
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el === button));
  els.filters.querySelectorAll(".filter-button").forEach(el => el.classList.toggle("active", el.dataset.filter === "all"));
  document.querySelector(".sidebar").classList.remove("open");
  render();
});

document.querySelector("#menuButton").addEventListener("click", () =>
  document.querySelector(".sidebar").classList.toggle("open"));

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    els.search.focus();
  }
});

load();
