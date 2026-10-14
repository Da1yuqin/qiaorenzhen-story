(() => {
  "use strict";

  const names = { huahua: "花花", goudan: "狗蛋", dahuang: "大黄" };
  const fields = [
    ["currentName", "此刻使用的名字"], ["location", "现在在哪里"],
    ["activity", "正在做什么"], ["intention", "此刻想要什么"],
    ["knows", "视野内已知"], ["misunderstanding", "误会与未知"],
  ];
  const apiSetting = window.QIAORENZHEN_AUTHOR_API_BASE === undefined
    ? window.QIAORENZHEN_STORY_API_BASE || window.QIAORENZHEN_API_BASE || ""
    : window.QIAORENZHEN_AUTHOR_API_BASE;
  const apiBase = validApiBase(apiSetting);
  const publicApiBase = validApiBase(window.QIAORENZHEN_STORY_API_BASE || window.QIAORENZHEN_API_BASE || "");
  const modeButtons = [...document.querySelectorAll("[data-story-mode]")];
  const loginPanel = document.querySelector("#author-login");
  const loginForm = document.querySelector("#author-login-form");
  const loginNote = document.querySelector("#author-login-note");
  const lorePanel = document.querySelector("#author-before-story");
  const workshopPanel = document.querySelector("#author-workshop");
  const cards = [...document.querySelectorAll(".intro-card[data-character-id]")];
  const fronts = new Map(cards.map((card) => [card.dataset.characterId, card.querySelector(".intro-card-copy")]));
  const portraits = new Map(cards.map((card) => [card.dataset.characterId, card.querySelector(".intro-portrait")]));
  let mode = "reader";
  let selectedAuthor = "huahua";
  let token = readToken();
  let session = null;
  let workshop = null;
  let lore = null;
  let portraitUrl = null;
  let requestSignature = null;
  let publicationId = null;

  function validApiBase(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim(), location.href);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
      return url.href.replace(/\/+$/, "");
    } catch { return ""; }
  }

  function readToken() {
    try { return sessionStorage.getItem("qiaorenzhen-author-token") || ""; }
    catch { return ""; }
  }

  function saveToken(value) {
    token = value;
    try {
      if (value) sessionStorage.setItem("qiaorenzhen-author-token", value);
      else sessionStorage.removeItem("qiaorenzhen-author-token");
    } catch { /* A private window may block storage; the current tab still works. */ }
  }

  async function api(path, method = "GET", payload) {
    if (!apiBase) throw new Error("作者口令尚未配置，暂时无法登录或续写。");
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(apiBase + path, {
        method, headers, body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: "no-store", mode: "cors",
      });
    } catch { throw new Error("作者服务暂时无法连接，请稍后再试。"); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login") saveToken("");
      throw new Error(typeof data.error === "string" ? data.error : `请求未完成（${response.status}）。`);
    }
    return data;
  }

  function el(tag, className, textValue) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue !== undefined) node.textContent = String(textValue);
    return node;
  }

  function section(label, title, className) {
    const root = el("section", `lore-section ${className}`);
    const small = el("div", "section-label");
    small.append(el("span", "", label), el("i"));
    root.append(small, el("h2", "", title));
    return root;
  }

  function storyDate(value) {
    const match = /^(\d{4})-(\d\d)-(\d\d)/.exec(value || "");
    return match ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日` : value || "";
  }

  function realDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric",
    }).format(date);
  }

  function dayStamp(value) {
    const match = /^(\d{4}-\d\d-\d\d)/.exec(value || "");
    return match ? Date.parse(`${match[1]}T00:00:00Z`) : NaN;
  }

  function fromStamp(value) {
    return new Date(value).toISOString().slice(0, 10) + "T00:00";
  }

  function selectedCharacter(wrapper) {
    return workshop?.characters.find((person) => person.id === wrapper.querySelector("#writing-character")?.value)
      || workshop?.characters[0];
  }

  function setMode(next) {
    mode = next;
    for (const button of modeButtons) {
      const active = button.dataset.storyMode === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (next === "reader") {
      loginPanel.hidden = true;
      lorePanel.hidden = true;
      workshopPanel.hidden = true;
      for (const card of cards) {
        showFront(card);
        card.classList.remove("intro-card--author");
        card.querySelector(".intro-card-flip").hidden = true;
      }
      return;
    }
    if (!apiBase) {
      loginPanel.hidden = false;
      loginNote.textContent = "作者口令正在安全配置，续写入口暂未开放；正文可以继续阅读。";
      loginForm.querySelector('button[type="submit"]').disabled = true;
      loginPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (session && workshop && lore) {
      revealAuthor();
    } else if (token) {
      loginPanel.hidden = false;
      loginNote.textContent = "正在取回作者设定……";
      void restoreSession();
    } else {
      loginPanel.hidden = false;
      loginNote.textContent = "";
      loginPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function showFront(card) {
    if (!card.classList.contains("intro-card--flipped")) return;
    const id = card.dataset.characterId;
    card.querySelector(".intro-card-copy")?.replaceWith(fronts.get(id));
    card.classList.remove("intro-card--flipped");
    const portrait = portraits.get(id);
    portrait.classList.remove("intro-portrait--author");
    portrait.style.removeProperty("background-image");
    portrait.setAttribute("aria-label", `${fronts.get(id)?.querySelector("h3")?.textContent || "人物"}的彩色正脸像`);
    const button = card.querySelector(".intro-card-flip");
    button.setAttribute("aria-pressed", "false");
    button.firstChild.textContent = "翻看完整设定";
  }

  function showBack(card) {
    if (!workshop || !lore || card.classList.contains("intro-card--flipped")) return;
    const id = card.dataset.characterId;
    const profile = lore.profiles.find((item) => item.id === id);
    const status = workshop.characters.find((item) => item.id === id);
    const back = el("div", "intro-card-copy intro-card-copy--back");
    back.tabIndex = 0;
    back.setAttribute("aria-label", `${fronts.get(id)?.querySelector("h3")?.textContent || id}的完整人物设定，可滚动阅读`);
    back.append(el("span", "intro-number", `${String(Number(card.dataset.characterIndex) + 1).padStart(2, "0")} · 作者手记`));
    back.append(el("small", "", profile?.identity || status?.currentName || "完整设定"));
    const title = el("div", "intro-name-row");
    title.append(el("h3", "", fronts.get(id)?.querySelector("h3")?.textContent || id));
    const seal = el("span", "intro-name-seal", card.dataset.characterSeal || "");
    seal.setAttribute("aria-hidden", "true");
    title.append(seal);
    back.append(title);
    if (profile?.background) back.append(el("p", "profile-paragraph", profile.background));
    if (profile?.innerConflict) {
      const paragraph = el("p", "profile-paragraph");
      paragraph.append(el("strong", "", "心中所困"), document.createTextNode(profile.innerConflict));
      back.append(paragraph);
    }
    if (status) {
      const facts = el("dl", "profile-facts");
      for (const [key, label] of fields) {
        if (!status[key]) continue;
        const row = el("div");
        row.append(el("dt", "", label), el("dd", "", status[key]));
        facts.append(row);
      }
      back.append(facts);
    }
    card.querySelector(".intro-card-copy")?.replaceWith(back);
    card.classList.add("intro-card--flipped");
    const portrait = portraits.get(id);
    if (portraitUrl) {
      portrait.classList.add("intro-portrait--author");
      portrait.style.backgroundImage = `url("${portraitUrl}")`;
      portrait.setAttribute("aria-label", "作者设定肖像");
    }
    const button = card.querySelector(".intro-card-flip");
    button.setAttribute("aria-pressed", "true");
    button.firstChild.textContent = "翻回初见";
  }

  async function loadProtectedPortrait(info) {
    if (!info || typeof info.url !== "string" || !/^\/api\/portrait\/[a-z-]+$/.test(info.url) || !apiBase || !token) return;
    try {
      const response = await fetch(apiBase + info.url, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", mode: "cors",
      });
      if (!response.ok || !/^image\/(png|jpeg|webp)$/.test(response.headers.get("Content-Type")?.split(";")[0] || "")) return;
      const blob = await response.blob();
      if (portraitUrl) URL.revokeObjectURL(portraitUrl);
      portraitUrl = URL.createObjectURL(blob);
    } catch { /* Text lore remains available when optional artwork cannot load. */ }
  }

  function renderSetting() {
    const root = section("卷内设定", "故事的另一面。", "setting-section");
    const prose = el("div", "setting-prose");
    for (const paragraph of lore.setting || []) prose.append(el("p", "", paragraph));
    root.append(prose);
    return root;
  }

  function renderSupporting() {
    const seen = new Set(cards.map((card) => card.dataset.characterId));
    const profiles = (lore.profiles || []).filter((item) => !seen.has(item.id));
    if (!profiles.length) return null;
    const root = section("其余人物", "尚未站在卷首，也牵动着故事。", "supporting-section");
    const grid = el("div", "supporting-grid");
    for (const profile of profiles) {
      const item = el("article", "supporting-profile");
      const person = workshop.characters.find((entry) => entry.id === profile.id);
      item.append(el("span", "", person?.name || profile.id), el("h3", "", profile.identity), el("p", "", profile.background));
      const conflict = el("p");
      conflict.append(el("strong", "", "心中所困"), document.createTextNode(profile.innerConflict || ""));
      item.append(conflict);
      grid.append(item);
    }
    root.append(grid);
    return root;
  }

  function svgNode(tag, attributes, content) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function renderRelations() {
    const root = section("人物关系", "此刻，他们如何牵连。", "relation-section");
    const known = new Map(workshop.characters.map((person) => [person.id, person.name]));
    const relations = (lore.relations || []).filter((item) => known.has(item.from) && known.has(item.to));
    const ids = [...new Set(relations.flatMap((item) => [item.from, item.to]))];
    const positions = new Map(ids.map((id, index) => [id, {
      x: 500 + 385 * Math.cos(2 * Math.PI * index / ids.length - Math.PI / 2),
      y: 300 + 215 * Math.sin(2 * Math.PI * index / ids.length - Math.PI / 2),
    }]));
    const map = el("div", "relation-map");
    const svg = svgNode("svg", { viewBox: "0 0 1000 600", role: "img", "aria-label": "人物关系节点与连线图", preserveAspectRatio: "xMidYMid meet" });
    for (const [index, relation] of relations.entries()) {
      const from = positions.get(relation.from), to = positions.get(relation.to);
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
      const x1 = from.x + dx / length * 49, y1 = from.y + dy / length * 49;
      const x2 = to.x - dx / length * 49, y2 = to.y - dy / length * 49;
      const middleX = (x1 + x2) / 2, middleY = (y1 + y2) / 2;
      svg.append(svgNode("line", { x1, y1, x2, y2, class: "relation-line" }));
      svg.append(svgNode("circle", { cx: middleX, cy: middleY, r: 16, class: "relation-index" }));
      svg.append(svgNode("text", { x: middleX, y: middleY + 4, class: "relation-index-text" }, String(index + 1)));
    }
    for (const [id, pos] of positions) {
      svg.append(svgNode("circle", { cx: pos.x, cy: pos.y, r: 47, class: "relation-node" }));
      svg.append(svgNode("text", { x: pos.x, y: pos.y + 6, class: "relation-node-name" }, known.get(id)));
    }
    map.append(svg);
    const notes = el("ol", "relation-notes");
    for (const [index, relation] of relations.entries()) {
      const item = el("li");
      const body = el("div");
      body.append(el("strong", "", `${known.get(relation.from)} → ${known.get(relation.to)} · ${relation.label}`), el("p", "", relation.note));
      item.append(el("span", "", String(index + 1).padStart(2, "0")), body);
      notes.append(item);
    }
    root.append(map, notes);
    return root;
  }

  function renderEvents() {
    const root = section("事件草图", "写到此处，时间怎样流动。", "event-section");
    root.append(el("p", "sketch-hint", "沿线向右看后续事件 →"));
    const track = el("ol", "event-track");
    for (const [index, event] of (lore.events || []).entries()) {
      const item = el("li");
      item.append(el("span", "event-index", String(index + 1).padStart(2, "0")));
      if (/^\d{4}-\d\d-\d\d/.test(event.at || "")) {
        const time = el("time", "", storyDate(event.at));
        time.dateTime = event.at;
        item.append(time);
      } else item.append(el("span", "event-time", event.at));
      item.append(el("h3", "", event.label), el("p", "", event.note));
      track.append(item);
    }
    root.append(track);
    return root;
  }

  function renderWorkshop() {
    const wrapper = el("section", "author-section");
    wrapper.innerHTML = `<div class="workshop-shell"><div class="workshop-top"><div><div class="section-label"><span>作者模式</span><i></i></div><h2>故事写到这里。</h2><p>选好视角与故事时间，续写的正文就会接在文末。</p></div><div class="signed-in"><span class="author-avatar"></span><div><strong></strong><small>正在执笔</small></div><button type="button" id="author-logout">退出</button></div></div><section class="workshop-card writing-card"><div class="card-eyebrow">✎ 续写正文</div><div class="writing-overview"><div class="writing-progress"><div class="progress-main"><strong id="current-story-time"></strong><span id="selected-story-time"></span></div><p id="story-summary"></p><div class="timeline-slider"><div class="slider-row"><span id="slider-min"></span><strong id="slider-now"></strong><span id="slider-max"></span></div><div class="range-wrap"><input id="writing-slider" type="range" aria-label="故事日期滑动条"><div class="range-marks" aria-hidden="true"></div></div><div class="slider-events" aria-label="故事事件路标"></div></div><div class="countdown" id="next-event-countdown"></div></div><aside class="selected-state" aria-label="当前人物状态"><label class="character-picker">这一段由谁讲述<select id="writing-character"></select></label><div class="card-eyebrow">这一视角中的人物</div><h3 id="selected-character-name"></h3><dl class="character-facts" id="selected-character-facts"></dl></aside></div><form id="chapter-publish-form"><div class="writing-fields"><label>正文标题中的名字<input id="writing-heading" maxlength="40" required></label><label>故事发生日期<input id="writing-date" type="date" required></label></div><div class="heading-preview">生成标题 <strong id="heading-preview"></strong></div><textarea class="chapter-editor" id="writing-body" aria-label="续写正文" placeholder="这天的故事，从这里往下写……" maxlength="100000" required></textarea><div class="editor-footer"><span id="writing-count">0 字 · 发布后接到文末，显示你的头像与更新日期</span><button type="submit" class="main-button">发布到文末 →</button></div><p class="author-publish-note" id="author-publish-note" role="status"></p></form></section></div>`;
    wrapper.querySelector(".signed-in .author-avatar").classList.add(`author-avatar--${session.author}`);
    wrapper.querySelector(".signed-in strong").textContent = session.name;
    wrapper.querySelector("#author-logout").addEventListener("click", logout);
    const selected = wrapper.querySelector("#writing-character");
    for (const person of workshop.characters) {
      const option = el("option", "", person.name);
      option.value = person.id;
      selected.append(option);
    }
    let preferred = "";
    try { preferred = localStorage.getItem("story-character") || ""; } catch { /* ignore */ }
    if (preferred && workshop.characters.some((person) => person.id === preferred)) selected.value = preferred;
    else if (workshop.characters.some((person) => person.id === "jinyun")) selected.value = "jinyun";
    selected.addEventListener("change", () => {
      try { localStorage.setItem("story-character", selected.value); } catch { /* ignore */ }
      updateCharacter(wrapper, true);
    });
    const current = workshop.timeline.currentStoryTime;
    const milestones = [...(workshop.timeline.milestones || [])].sort((a, b) => a.at.localeCompare(b.at));
    const currentStamp = dayStamp(current);
    const firstStamp = dayStamp(milestones[0]?.at);
    const lastStamp = dayStamp(milestones.at(-1)?.at);
    const min = Number.isFinite(firstStamp) ? Math.min(firstStamp, currentStamp) : currentStamp;
    const max = Math.max(Number.isFinite(lastStamp) ? lastStamp : currentStamp, currentStamp) + 30 * 86400000;
    const slider = wrapper.querySelector("#writing-slider");
    slider.min = String(min); slider.max = String(max); slider.step = String(86400000);
    slider.value = String(currentStamp);
    wrapper.querySelector("#slider-min").textContent = storyDate(fromStamp(min));
    wrapper.querySelector("#slider-max").textContent = storyDate(fromStamp(max));
    wrapper.querySelector("#current-story-time").textContent = storyDate(current);
    wrapper.querySelector("#story-summary").textContent = workshop.summary || "";
    const marks = wrapper.querySelector(".range-marks");
    const labels = wrapper.querySelector(".slider-events");
    for (const item of milestones) {
      const stamp = dayStamp(item.at);
      if (!Number.isFinite(stamp)) continue;
      const mark = el("span", `range-mark ${item.kind || "past"}`);
      mark.style.left = `${Math.min(100, Math.max(0, (stamp - min) / (max - min) * 100))}%`;
      mark.title = `${storyDate(item.at)} ${item.label}`;
      marks.append(mark);
    }
    for (const item of milestones.slice(-4)) {
      const label = el("span", "slider-event");
      label.append(el("i", item.kind || "past"), document.createTextNode(item.label));
      label.title = storyDate(item.at);
      labels.append(label);
    }
    slider.addEventListener("input", () => updateTime(wrapper, fromStamp(Number(slider.value))));
    wrapper.querySelector("#writing-date").addEventListener("change", (event) => updateTime(wrapper, `${event.target.value}T00:00`));
    wrapper.querySelector("#writing-heading").addEventListener("input", () => updatePreview(wrapper));
    wrapper.querySelector("#writing-body").addEventListener("input", (event) => {
      wrapper.querySelector("#writing-count").textContent = `${event.target.value.replace(/\s/g, "").length} 字 · 发布后接到文末，显示你的头像与更新日期`;
    });
    wrapper.querySelector("#chapter-publish-form").addEventListener("submit", publish);
    updateCharacter(wrapper, true);
    updateTime(wrapper, current);
    return wrapper;
  }

  function updateCharacter(wrapper, suggestHeading) {
    const person = selectedCharacter(wrapper);
    if (!person) return;
    wrapper.querySelector("#selected-character-name").textContent = person.name;
    const facts = wrapper.querySelector("#selected-character-facts");
    facts.replaceChildren();
    for (const [key, label] of fields) {
      const row = el("div", "state-line");
      row.append(el("dt", "", label), el("dd", "", person[key] || ""));
      facts.append(row);
    }
    if (suggestHeading) wrapper.querySelector("#writing-heading").value = person.currentName?.split("／")[0].replace(/（[^）]*）/g, "").trim() || person.name;
    updatePreview(wrapper);
  }

  function updateTime(wrapper, value) {
    const slider = wrapper.querySelector("#writing-slider");
    const stamp = dayStamp(value);
    if (!Number.isFinite(stamp)) return;
    const clamped = Math.max(Number(slider.min), Math.min(Number(slider.max), stamp));
    slider.value = String(clamped);
    const date = fromStamp(clamped).slice(0, 10);
    wrapper.querySelector("#writing-date").value = date;
    wrapper.querySelector("#selected-story-time").textContent = `本次写作：${storyDate(date)}`;
    wrapper.querySelector("#slider-now").textContent = storyDate(date);
    const next = [...(workshop.timeline.milestones || [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .find((item) => item.kind === "planned" && dayStamp(item.at) > clamped);
    wrapper.querySelector("#next-event-countdown").textContent = next
      ? `✦ 距「${next.label}」还有约 ${Math.round((dayStamp(next.at) - clamped) / 86400000)} 天`
      : "✦ 暂未设置下一处预定事件。";
    updatePreview(wrapper);
  }

  function updatePreview(wrapper) {
    const date = wrapper.querySelector("#writing-date").value;
    const heading = wrapper.querySelector("#writing-heading").value.trim();
    wrapper.querySelector("#heading-preview").textContent = `${storyDate(date)} ${heading}`.trim();
  }

  function revealAuthor() {
    if (mode !== "author" || !session || !workshop || !lore) return;
    loginPanel.hidden = true;
    for (const card of cards) {
      card.classList.add("intro-card--author");
      card.querySelector(".intro-card-flip").hidden = false;
    }
    if (!lorePanel.firstElementChild) {
      const supporting = renderSupporting();
      lorePanel.replaceChildren(renderSetting(), ...(supporting ? [supporting] : []), renderRelations(), renderEvents());
    }
    lorePanel.hidden = false;
    if (!workshopPanel.firstElementChild) workshopPanel.replaceChildren(renderWorkshop());
    workshopPanel.hidden = false;
  }

  async function restoreSession() {
    try {
      const [story, data] = await Promise.all([api("/api/story"), api("/api/workshop")]);
      if (!story.session || !data.state || !data.lore) throw new Error("作者会话已过期，请重新登录。");
      session = story.session;
      workshop = data.state;
      lore = data.lore;
      await loadProtectedPortrait(data.portrait);
      revealAuthor();
    } catch (error) {
      saveToken("");
      session = null; workshop = null; lore = null;
      if (mode === "author") {
        loginPanel.hidden = false;
        loginNote.textContent = error.message;
      }
    }
  }

  async function login(event) {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    loginNote.textContent = "正在进入作者模式……";
    try {
      const data = await api("/api/login", "POST", {
        author: selectedAuthor, password: loginForm.querySelector("#author-password").value,
      });
      if (!data.token || !data.session) throw new Error("登录服务没有返回有效会话。");
      saveToken(data.token);
      session = data.session;
      const privateData = await api("/api/workshop");
      if (!privateData.state || !privateData.lore) throw new Error("作者设定暂时无法读取。");
      workshop = privateData.state;
      lore = privateData.lore;
      loginForm.reset();
      await loadProtectedPortrait(privateData.portrait);
      revealAuthor();
      document.querySelector("#characters")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      loginNote.textContent = error.message;
    } finally { button.disabled = false; }
  }

  async function logout() {
    try { await api("/api/logout", "POST", {}); } catch { /* Clearing the local session is sufficient. */ }
    saveToken("");
    session = null; workshop = null; lore = null;
    lorePanel.replaceChildren();
    workshopPanel.replaceChildren();
    if (portraitUrl) URL.revokeObjectURL(portraitUrl);
    portraitUrl = null;
    setMode("reader");
  }

  function appendChapter(chapter) {
    if (!chapter || !/^[a-z0-9-]+$/.test(chapter.id) || document.getElementById(chapter.id)) return;
    const chapters = document.querySelector(".chapters");
    const index = chapters.querySelectorAll("article.chapter").length + 1;
    const article = el("article", "chapter");
    article.id = chapter.id;
    article.append(el("div", "chapter-kicker", `第 ${String(index).padStart(2, "0")} 段 · 半日闲记事`), el("h3", "", chapter.heading));
    if (names[chapter.author]) {
      const byline = el("div", "chapter-byline");
      const avatar = el("span", `author-avatar tiny author-avatar--${chapter.author}`);
      avatar.setAttribute("role", "img");
      avatar.setAttribute("aria-label", `${names[chapter.author]}的头像`);
      byline.append(avatar, el("strong", "", names[chapter.author]));
      const time = el("time", "", `${realDate(chapter.publishedAt)} 更新`);
      if (chapter.publishedAt) time.dateTime = chapter.publishedAt;
      byline.append(time);
      article.append(byline);
    }
    const prose = el("div", "prose");
    for (const text of (chapter.body || "").split(/\n+/).map((piece) => piece.trim()).filter(Boolean)) prose.append(el("p", "", text));
    article.append(prose);
    const interactions = el("div", "chapter-interactions");
    const actions = el("div", "chapter-actions");
    const like = el("button", "chapter-action chapter-like");
    like.type = "button"; like.dataset.chapter = chapter.id; like.setAttribute("aria-pressed", "false");
    like.setAttribute("aria-label", `喜欢第${index}段`);
    like.append(el("span", "heart-mark", "♡"), document.createTextNode(" 喜欢这一章"));
    const toggle = el("button", "chapter-action chapter-comment-toggle", "评论这一章");
    toggle.type = "button"; toggle.dataset.chapter = chapter.id;
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", `chapter-comments-${chapter.id}`);
    actions.append(like, toggle);
    const discussion = el("div", "chapter-discussion");
    discussion.id = `chapter-comments-${chapter.id}`;
    discussion.dataset.commentPage = `/qiaorenzhen-story/chapter/${chapter.id}/`;
    discussion.hidden = true;
    interactions.append(actions, discussion);
    article.append(interactions);
    chapters.append(article);
    const rail = document.querySelector(".chapter-rail > div");
    const link = el("a", "", chapter.heading);
    link.href = `#${chapter.id}`;
    link.prepend(el("span", "", String(index).padStart(2, "0")));
    rail?.append(link);
    const count = document.querySelector(".chapter-count");
    if (count) count.textContent = `共 ${index} 段 · 持续连载`;
    document.dispatchEvent(new CustomEvent("story:chapter-added", { detail: { chapterId: chapter.id } }));
  }

  async function syncPublicChapters() {
    if (!publicApiBase) return;
    try {
      const response = await fetch(`${publicApiBase}/api/story`, { cache: "no-store", mode: "cors" });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.chapters)) for (const chapter of data.chapters) appendChapter(chapter);
    } catch { /* The published static chapters stay readable if the API is offline. */ }
  }

  async function publish(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = form.querySelector("#writing-body").value;
    const date = form.querySelector("#writing-date").value;
    const viewpoint = form.querySelector("#writing-heading").value.trim();
    const note = form.querySelector("#author-publish-note");
    const button = form.querySelector('button[type="submit"]');
    const signature = JSON.stringify({ body, date, viewpoint });
    if (signature !== requestSignature) {
      requestSignature = signature;
      publicationId = crypto.randomUUID();
    }
    button.disabled = true;
    note.textContent = "正在发布……";
    try {
      const data = await api("/api/chapters", "POST", {
        body, storyTime: `${date}T00:00`, viewpoint, requestId: publicationId,
      });
      if (!data.chapter) throw new Error("章节已经提交，但尚未收到章节信息；请刷新检查文末。");
      appendChapter(data.chapter);
      form.querySelector("#writing-body").value = "";
      form.querySelector("#writing-count").textContent = "0 字 · 发布后接到文末，显示你的头像与更新日期";
      requestSignature = null; publicationId = null;
      note.textContent = "这一段已接在文末。";
      document.getElementById(data.chapter.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      note.textContent = error.message;
    } finally { button.disabled = false; }
  }

  for (const button of modeButtons) button.addEventListener("click", () => setMode(button.dataset.storyMode));
  for (const button of document.querySelectorAll(".author-choices [data-author]")) {
    button.addEventListener("click", () => {
      selectedAuthor = button.dataset.author;
      for (const choice of document.querySelectorAll(".author-choices [data-author]")) {
        const active = choice === button;
        choice.classList.toggle("selected", active);
        choice.setAttribute("aria-pressed", String(active));
      }
      document.querySelector("#author-password-label").textContent = names[selectedAuthor];
    });
  }
  for (const card of cards) card.querySelector(".intro-card-flip").addEventListener("click", () => {
    if (card.classList.contains("intro-card--flipped")) showFront(card);
    else showBack(card);
  });
  loginForm.addEventListener("submit", login);
  void syncPublicChapters();
})();
