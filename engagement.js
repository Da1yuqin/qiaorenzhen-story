(() => {
  "use strict";

  const STORY_ROOT = "/qiaorenzhen-story/";
  const commentSetting = window.QIAORENZHEN_COMMENTS_API_BASE || "https://day-blog-comments.pages.dev";
  const commentsUrl = commentSetting.replace(/\/+$/, "") + (commentSetting.replace(/\/+$/, "").endsWith("/comments") ? "" : "/comments");
  // Optional independent service. It follows the former story site's /api/story and /api/likes contract.
  const storyApi = (window.QIAORENZHEN_STORY_API_BASE || window.QIAORENZHEN_API_BASE || "").replace(/\/+$/, "");
  const boards = new WeakMap();
  let sharedCounts = null;
  let storySnapshot = null;
  let storySnapshotAt = 0;
  let storyRequest = null;
  const syncedLikes = new Set();

  function make(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function storedName() {
    try { return localStorage.getItem("qiaorenzhen-comment-name") || ""; } catch { return ""; }
  }

  function rememberName(name) {
    try { localStorage.setItem("qiaorenzhen-comment-name", name); } catch { /* Private browsing may block storage. */ }
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "服务暂时不可用，请稍后重试。");
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  function commentEndpoint(page) {
    const url = new URL(commentsUrl, location.href);
    if (page) url.searchParams.set("page", page);
    return url.toString();
  }

  async function getStorySnapshot(force = false) {
    if (force && storyRequest) await storyRequest.catch(() => {});
    if (!force && storySnapshot && Date.now() - storySnapshotAt < 15000) return storySnapshot;
    if (!storyRequest) {
      storyRequest = request(`${storyApi}/api/story`).then((result) => {
        storySnapshot = result;
        storySnapshotAt = Date.now();
        return result;
      }).finally(() => { storyRequest = null; });
    }
    return storyRequest;
  }

  function safeDate(value) {
    if (!value) return { label: "刚刚", iso: "" };
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(value) ? value.replace(" ", "T") + "Z" : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime())
      ? { label: String(value).slice(0, 10), iso: "" }
      : { label: date.toLocaleDateString("zh-CN"), iso: date.toISOString() };
  }

  function renderComments(board, state) {
    const list = state.list;
    list.replaceChildren();
    const count = board.querySelector(".comment-count");
    if (count) {
      count.textContent = `${state.comments.length} 条评论`;
      count.hidden = false;
    }
    const toggle = document.querySelector(`.chapter-comment-toggle[aria-controls="${board.id}"]`);
    if (toggle) {
      const toggleCount = toggle.querySelector(".chapter-comment-count") || make("span", "chapter-comment-count");
      toggleCount.textContent = String(state.comments.length);
      if (!toggleCount.isConnected) toggle.append(toggleCount);
    }
    if (!state.comments.length) {
      list.append(make("p", "no-comments", "还没有评论。你可以先说第一句。"));
      return;
    }
    const byId = new Map(state.comments.map((comment) => [comment.id, comment]));
    for (const comment of state.comments) {
      const name = typeof comment.name === "string" && comment.name.trim() ? comment.name.trim() : "匿名";
      const item = make("article", "comment");
      const initial = make("span", "comment-initial", name.slice(0, 1));
      initial.setAttribute("aria-hidden", "true");
      const body = make("div", "comment-body");
      const meta = make("div", "comment-meta");
      meta.append(make("strong", "", name));
      const when = safeDate(comment.created_at);
      const time = make("time", "", when.label);
      if (when.iso) time.dateTime = when.iso;
      meta.append(time);
      if (comment.parent_id && byId.has(comment.parent_id)) {
        const parent = byId.get(comment.parent_id);
        meta.append(make("span", "comment-reply-to", `回复 ${parent.name || "匿名"}`));
      }
      body.append(meta, make("p", "", comment.content || ""));
      const reply = make("button", "comment-reply", "回复");
      reply.type = "button";
      reply.addEventListener("click", () => {
        state.parent = comment;
        state.replyLabel.textContent = `回复 ${name}`;
        state.replyContext.hidden = false;
        state.content.focus();
        state.form.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      if (!storyApi) body.append(reply);
      item.append(initial, body);
      list.append(item);
    }
  }

  async function loadComments(board, state) {
    if (state.loading) return state.loading;
    state.status.textContent = "正在翻看留言……";
    state.loading = (async () => {
      try {
        let rows;
        if (storyApi) {
          const snapshot = await getStorySnapshot(state.forceRefresh);
          state.forceRefresh = false;
          const chapterId = state.page === STORY_ROOT ? null : state.page.slice(`${STORY_ROOT}chapter/`.length, -1);
          rows = chapterId ? snapshot.chapterComments?.[chapterId] : snapshot.comments;
          rows = Array.isArray(rows) ? rows.slice().reverse() : [];
        } else {
          const result = await request(commentEndpoint(state.page));
          rows = Array.isArray(result.comments) ? result.comments : [];
        }
        state.comments = rows.map((comment) => ({...comment, created_at: comment.createdAt || comment.created_at}));
        renderComments(board, state);
        state.loaded = true;
        state.loadOk = true;
        state.status.textContent = "";
      } catch (error) {
        state.loadOk = false;
        state.status.textContent = error.name === "AbortError"
          ? "评论加载超时，请稍后再试。"
          : "评论暂时加载失败，请稍后再试。";
      } finally {
        state.loading = null;
      }
    })();
    return state.loading;
  }

  function initBoard(board) {
    if (boards.has(board)) return boards.get(board);
    const page = board.dataset.commentPage;
    if (!page || !/^\/[a-zA-Z0-9/_-]+\/$/.test(page)) return null;
    let host = board.querySelector(".comment-board-content");
    if (!host) {
      host = make("div", "comment-board-content");
      board.append(host);
    }
    const form = make("form", "chapter-comment-form");
    const nameLabel = make("label", "", "怎么称呼你？");
    const name = make("input");
    name.name = "commenter";
    name.maxLength = storyApi ? 32 : 40;
    name.required = true;
    name.autocomplete = "name";
    name.placeholder = "你的称呼";
    name.value = storedName();
    nameLabel.append(name);
    const contentLabel = make("label", "", "想留下什么话？");
    const content = make("textarea");
    content.name = "content";
    content.maxLength = storyApi ? 3000 : 2000;
    content.rows = 3;
    content.required = true;
    content.placeholder = "读到这里，你想说些什么……";
    contentLabel.append(content);
    const replyContext = make("div", "comment-reply-context");
    replyContext.hidden = true;
    const replyLabel = make("span");
    const cancel = make("button", "comment-reply-cancel", "取消回复");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      state.parent = null;
      replyContext.hidden = true;
    });
    replyContext.append(replyLabel, cancel);
    const actions = make("div", "form-actions");
    actions.append(make("span", "", "评论会公开显示在这里。"));
    const submit = make("button", "", "送出评论");
    submit.type = "submit";
    actions.append(submit);
    const status = make("p", "comment-board-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    form.append(nameLabel, contentLabel, replyContext, actions, status);
    const list = make("div", "comment-list");
    list.setAttribute("aria-live", "polite");
    host.append(form, list);
    const state = { page, form, name, content, replyContext, replyLabel, status, list, submit, parent: null, comments: [], loaded: false, loadOk: false, loading: null, pendingSignature: null, pendingRequestId: null, forceRefresh: false };
    boards.set(board, state);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || submit.disabled) return;
      submit.disabled = true;
      status.textContent = "正在送出评论……";
      const input = storyApi
        ? { name: name.value.trim(), content: content.value.trim(), ...(page === STORY_ROOT ? {} : {chapterId: page.slice(`${STORY_ROOT}chapter/`.length, -1)}) }
        : { page, name: name.value.trim(), content: content.value.trim(), visibility: "public", parent_id: state.parent ? state.parent.id : null };
      if (storyApi) {
        const signature = JSON.stringify(input);
        if (signature !== state.pendingSignature) {
          state.pendingSignature = signature;
          state.pendingRequestId = crypto.randomUUID();
        }
        input.requestId = state.pendingRequestId;
      }
      try {
        await request(storyApi ? `${storyApi}/api/comments` : commentEndpoint(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input)
        });
        state.pendingSignature = null;
        state.pendingRequestId = null;
        rememberName(input.name);
        content.value = "";
        state.parent = null;
        replyContext.hidden = true;
        if (state.loading) await state.loading;
        state.forceRefresh = true;
        await loadComments(board, state);
        status.textContent = state.loadOk ? "评论已公开发布。" : "评论已发布，列表暂时加载失败；稍后刷新即可看到。";
      } catch (error) {
        status.textContent = error.name === "AbortError" || error instanceof TypeError
          ? "连接失败，请稍后重试；输入内容已保留。"
          : error.message;
      } finally {
        submit.disabled = false;
      }
    });
    return state;
  }

  function prepareChapters() {
    document.querySelectorAll(".chapter").forEach((chapter) => {
      const id = chapter.id;
      if (!/^[a-z0-9-]+$/.test(id)) return;
      const interactions = chapter.querySelector(".chapter-interactions");
      if (!interactions) return;
      let board = interactions.querySelector(".chapter-discussion");
      if (!board) {
        board = make("section", "chapter-discussion comment-board");
        board.hidden = true;
        interactions.append(board);
      }
      if (!interactions.querySelector(".like-save-note")) {
        interactions.insertBefore(make("p", "like-save-note", "喜欢会先记在当前浏览器。"), board);
      }
      board.classList.add("comment-board");
      board.id ||= `chapter-comments-${id}`;
      board.dataset.commentPage ||= `${STORY_ROOT}chapter/${id}/`;
      let toggle = interactions.querySelector(".chapter-comment-toggle");
      if (!toggle) {
        toggle = make("button", "chapter-action chapter-comment-toggle", "评论这一章");
        toggle.type = "button";
        (interactions.querySelector(".chapter-actions") || interactions).append(toggle);
      }
      toggle.classList.add("chapter-action");
      if (!toggle.querySelector(".chapter-comment-label")) {
        for (const child of [...toggle.childNodes]) {
          if (child.nodeType === Node.TEXT_NODE) child.remove();
        }
        toggle.prepend(make("span", "chapter-comment-label", "评论这一章"));
      }
      toggle.setAttribute("aria-controls", board.id);
      if (!toggle.hasAttribute("aria-expanded")) toggle.setAttribute("aria-expanded", "false");
      if (!board.querySelector(".chapter-discussion-heading")) {
        const heading = make("div", "chapter-discussion-heading");
        heading.append(make("strong", "", "读到这一章，你想说些什么？"));
        board.prepend(heading);
      }
      initBoard(board);
    });
  }

  function setLikeNote(message, chapterId) {
    const notes = chapterId
      ? document.getElementById(chapterId)?.querySelectorAll(".like-save-note") || []
      : document.querySelectorAll(".hero .like-save-note, .reader-end .like-save-note");
    notes.forEach((note) => { note.textContent = message; });
  }

  function showLikeCount(key, value) {
    if (!Number.isSafeInteger(value) || value < 0) return;
    document.querySelectorAll(".story-like, .chapter-like").forEach((button) => {
      if ((button.dataset.chapter || "story") !== key) return;
      let count = button.querySelector(".like-count");
      if (!count) {
        count = make("span", "like-count");
        button.append(count);
      }
      count.textContent = String(value);
      count.setAttribute("aria-label", `${value} 人喜欢`);
    });
  }

  function applySharedCounts(data) {
    if (!Number.isSafeInteger(data.likes) || data.likes < 0 || !data.chapterLikes || typeof data.chapterLikes !== "object") {
      throw new Error("点赞服务返回了无效数据。");
    }
    sharedCounts = data;
    showLikeCount("story", data.likes);
    document.querySelectorAll(".chapter-like[data-chapter]").forEach((button) => {
      const value = data.chapterLikes[button.dataset.chapter] ?? 0;
      showLikeCount(button.dataset.chapter, value);
    });
    document.querySelectorAll(".like-save-note").forEach((note) => { note.textContent = "全站喜欢已同步。"; });
  }

  async function refreshSharedCounts(force = false) {
    if (!storyApi) return false;
    try {
      const data = await getStorySnapshot(force);
      applySharedCounts(data);
      return true;
    } catch {
      document.querySelectorAll(".like-save-note").forEach((note) => {
        note.textContent = "全站喜欢暂时不可用；本次喜欢会先记在当前浏览器。";
      });
      return false;
    }
  }

  function visitorId() {
    try {
      let id = localStorage.getItem("qiaorenzhen-visitor-id");
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("qiaorenzhen-visitor-id", id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  async function syncExistingLikes() {
    if (!await refreshSharedCounts()) return;
    let saved;
    try { saved = JSON.parse(localStorage.getItem("qiaorenzhen-liked") || "[]"); } catch { return; }
    if (!Array.isArray(saved)) return;
    const visible = new Set([...document.querySelectorAll(".story-like, .chapter-like")].map((button) => button.dataset.chapter || "story"));
    const keys = [...new Set(saved)].filter((key) => visible.has(key));
    if (!keys.length) return;
    const id = visitorId();
    const results = await Promise.allSettled(keys.map((key) => request(`${storyApi}/api/likes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: id, ...(key === "story" ? {} : { chapterId: key }) })
    })));
    let failed = false;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") syncedLikes.add(keys[index]);
      else failed = true;
    });
    await refreshSharedCounts(true);
    if (failed) document.querySelectorAll(".like-save-note").forEach((note) => {
      note.textContent = "部分本机喜欢尚未同步；下次打开时会再试。";
    });
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".chapter-comment-toggle");
    if (!toggle) return;
    const board = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!board) return;
    board.hidden = !board.hidden;
    toggle.setAttribute("aria-expanded", String(!board.hidden));
    toggle.querySelector(".chapter-comment-label").textContent = board.hidden ? "评论这一章" : "收起评论";
    const state = initBoard(board);
    if (state && !board.hidden && !state.loaded) loadComments(board, state);
  });

  window.addEventListener("story:liked", async (event) => {
    const { key, chapterId, firstLike } = event.detail || {};
    if (!storyApi || (!firstLike && syncedLikes.has(key))) return;
    try {
      const data = await request(`${storyApi}/api/likes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: visitorId(), ...(chapterId ? { chapterId } : {}) })
      });
      showLikeCount(key, data.likes);
      syncedLikes.add(key);
      setLikeNote("全站喜欢已同步。", chapterId);
      const popupText = document.querySelector(".like-popup p");
      if (popupText && !document.getElementById("like-popup")?.hidden) {
        popupText.textContent = "这份喜欢已送到茶馆。故事会继续写下去。";
      }
    } catch {
      setLikeNote("全站同步暂时不可用；喜欢已记在当前浏览器。", chapterId);
    }
  });

  prepareChapters();
  document.querySelectorAll(".comment-board:not([hidden])").forEach((board) => {
    const state = initBoard(board);
    if (state) loadComments(board, state);
  });
  document.addEventListener("story:chapter-added", () => {
    prepareChapters();
    if (sharedCounts) applySharedCounts(sharedCounts);
    if (storyApi) refreshSharedCounts();
  });
  if (storyApi) syncExistingLikes();
})();
