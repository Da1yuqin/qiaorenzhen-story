(() => {
  const authors = { huahua: "花花", goudan: "狗蛋", dahuang: "大黄" };
  const authorToggle = document.querySelector("#chapter-author-toggle");
  const authorDisplayKey = "qiaorenzhen-show-chapter-authors";
  let showChapterAuthors = true;
  try { showChapterAuthors = localStorage.getItem(authorDisplayKey) !== "false"; } catch { /* Use the visible default. */ }
  function setAuthorDisplay(visible) {
    document.documentElement.classList.toggle("hide-chapter-authors", !visible);
    if (authorToggle) authorToggle.checked = visible;
  }
  setAuthorDisplay(showChapterAuthors);
  authorToggle?.addEventListener("change", () => {
    setAuthorDisplay(authorToggle.checked);
    try { localStorage.setItem(authorDisplayKey, String(authorToggle.checked)); } catch { /* The toggle still works for this visit. */ }
  });
  const chapterRail = document.querySelector(".chapter-rail");
  chapterRail?.addEventListener("click", (event) => {
    if (event.target.closest("a[href^='#']")) chapterRail.open = false;
  });
  document.addEventListener("pointerdown", (event) => {
    if (chapterRail?.open && !chapterRail.contains(event.target)) chapterRail.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !chapterRail?.open) return;
    chapterRail.open = false;
    chapterRail.querySelector("summary")?.focus();
  });
  const popup = document.querySelector("#like-popup");
  const portrait = popup.querySelector(".like-popup > .author-avatar");
  const title = popup.querySelector("#popup-title");
  const close = popup.querySelector(".popup-close");
  let returnFocus = null;

  function readLikes() {
    try {
      return new Set(JSON.parse(localStorage.getItem("qiaorenzhen-liked") || "[]"));
    } catch {
      return new Set();
    }
  }

  function saveLikes(likes) {
    try {
      localStorage.setItem("qiaorenzhen-liked", JSON.stringify([...likes]));
    } catch {
      // Reading and the author portrait still work when storage is unavailable.
    }
  }

  function selectAuthor(id) {
    portrait.className = `author-avatar large author-avatar--${id}`;
    portrait.setAttribute("aria-label", `${authors[id]}的头像`);
    title.textContent = authors[id];
    popup.querySelectorAll("[data-author]").forEach((button) => {
      button.classList.toggle("active", button.dataset.author === id);
    });
  }

  function openPopup() {
    const names = Object.keys(authors);
    selectAuthor(names[Math.floor(Math.random() * names.length)]);
    popup.querySelector(".like-popup p").textContent = "谢谢你的喜欢，故事会继续写下去。";
    returnFocus = document.activeElement;
    popup.hidden = false;
    close.focus();
  }

  function closePopup() {
    popup.hidden = true;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }

  const liked = readLikes();
  const bound = new WeakSet();

  function showLikeState(key) {
    document.querySelectorAll(".story-like, .chapter-like").forEach((button) => {
      if ((button.dataset.chapter || "story") !== key) return;
      const isLiked = liked.has(key);
      button.setAttribute("aria-pressed", String(isLiked));
      const heart = button.querySelector(".heart-mark");
      if (heart) heart.textContent = isLiked ? "♥" : "♡";
    });
  }

  function bindLikeButtons() {
    document.querySelectorAll(".story-like, .chapter-like").forEach((button) => {
      if (bound.has(button)) return;
      bound.add(button);
      const key = button.dataset.chapter || "story";
      showLikeState(key);
      button.addEventListener("click", () => {
        const firstLike = !liked.has(key);
        if (firstLike) {
          liked.add(key);
          saveLikes(liked);
          showLikeState(key);
        }
        window.dispatchEvent(new CustomEvent("story:liked", {
          detail: { key, chapterId: key === "story" ? null : key, firstLike }
        }));
        openPopup();
      });
    });
  }

  bindLikeButtons();
  document.addEventListener("story:chapter-added", bindLikeButtons);
  close.addEventListener("click", closePopup);
  popup.addEventListener("click", (event) => { if (event.target === popup) closePopup(); });
  popup.querySelectorAll("[data-author]").forEach((button) => {
    button.addEventListener("click", () => selectAuthor(button.dataset.author));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) closePopup();
  });
})();
