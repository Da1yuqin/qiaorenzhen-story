#!/usr/bin/env python3
"""Build the public story shell; private author material comes from the API."""

from __future__ import annotations

import html
import json
import re
from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STORY = ROOT / "data" / "story.json"
SITE_LOG = ROOT / "data" / "site-log.json"
SITE_CHANGELOG = ROOT / "data" / "site-changelog.json"
OUTPUT = ROOT / "index.html"
AUTHOR_NAMES = {"huahua": "花花", "goudan": "狗蛋", "dahuang": "大黄"}
AUTHOR_SEALS = {"huahua": "花", "goudan": "蛋", "dahuang": "黄"}
CHARACTER_SEALS = {"zhou": "茶", "jinyun": "药", "sanmei": "灯", "wangcai": "书", "tong": "账"}
STORY_API_BASE = "https://qiaorenzhen-story-api.pages.dev"


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def asset_url(name: str) -> str:
    digest = sha256((ROOT / name).read_bytes()).hexdigest()[:10]
    return f"{name}?v={digest}"


def image_path(source: str) -> str:
    path = source.lstrip("/")
    if not path.startswith("assets/") or ".." in Path(path).parts:
        raise ValueError(f"Invalid illustration path: {source}")
    if not (ROOT / path).is_file():
        raise FileNotFoundError(ROOT / path)
    return path


def illustration_html(art: dict) -> str:
    return (
        '<figure class="chapter-illustration">'
        f'<img src="{escape(image_path(art["src"]))}" alt="{escape(art["alt"])}" '
        'loading="lazy" decoding="async" width="1536" height="1024">'
        '<figcaption><span>卷中一景</span><i aria-hidden="true"></i>'
        f'{escape(art["caption"])}</figcaption></figure>'
    )


def prose_html(chapter: dict, art: dict | None) -> str:
    paragraphs = [piece.strip() for piece in re.split(r"\n+", chapter["body"]) if piece.strip()]
    if not paragraphs:
        raise ValueError(f'Empty chapter: {chapter["id"]}')
    anchor = next((i for i, piece in enumerate(paragraphs) if art and art["after"] in piece), len(paragraphs) - 1)
    rendered = []
    for index, paragraph in enumerate(paragraphs):
        rendered.append(f"<p>{escape(paragraph)}</p>")
        if art and index == anchor:
            rendered.append(illustration_html(art))
    return '<div class="prose">' + "\n".join(rendered) + "</div>"


def comment_board_html(board_id: str, page: str, title: str, *, hidden: bool) -> str:
    return (
        f'<section class="comment-board chapter-discussion" id="{escape(board_id)}" '
        f'data-comment-page="{escape(page)}" aria-label="{escape(title)}"'
        + (' hidden' if hidden else '')
        + '><div class="chapter-discussion-heading"><strong>'
        + escape(title)
        + '</strong><span class="comment-count" hidden></span></div>'
        + '<div class="comment-board-content"></div></section>'
    )


def chapter_html(chapter: dict, index: int, art: dict | None) -> str:
    chapter_id = chapter["id"]
    if not re.fullmatch(r"[a-z0-9-]+", chapter_id):
        raise ValueError(f"Invalid chapter id: {chapter_id}")
    author = chapter.get("author")
    author_hint = chapter.get("authorHint")
    byline = (
        '<div class="chapter-byline chapter-byline--unverified">'
        '<span class="chapter-author-seal" aria-hidden="true">考</span>'
        '<strong>执笔待考</strong>'
        + (f'<small class="chapter-author-hint">{escape(author_hint)}</small>' if author_hint else "")
        + '</div>'
    )
    if author in AUTHOR_NAMES:
        updated = chapter.get("updatedAt") or chapter.get("publishedAt") or ""
        date = updated[:16].replace("T", " ")
        byline = (
            '<div class="chapter-byline">'
            f'<span class="chapter-author-seal" aria-hidden="true">{escape(AUTHOR_SEALS[author])}</span>'
            f'<span class="author-avatar tiny author-avatar--{author}" role="img" '
            f'aria-label="{escape(AUTHOR_NAMES[author])}的头像"></span>'
            f'<strong>执笔 · {escape(AUTHOR_NAMES[author])}</strong>'
            + (f'<time datetime="{escape(updated)}">{escape(date)} 更新</time>' if date else "")
            + "</div>"
        )
    divider = (
        '<div class="story-divider"><span>2018 — 2026</span><i></i><span>故事继续</span></div>'
        if chapter_id == "new-20261013-01" else ""
    )
    return (
        divider
        + f'<article class="chapter" id="{chapter_id}">'
        + f'<div class="chapter-kicker">第 {index:02d} 段 · 半日闲记事</div>'
        + f'<h3>{escape(chapter["heading"])}</h3>{byline}'
        + prose_html(chapter, art)
        + '<div class="chapter-interactions"><div class="chapter-actions"><button type="button" class="chapter-action chapter-like" '
        + f'data-chapter="{chapter_id}" aria-pressed="false" aria-label="喜欢第{index}段">'
        + '<span class="heart-mark" aria-hidden="true">♡</span> 喜欢这一章</button>'
        + f'<button type="button" class="chapter-action chapter-comment-toggle" data-chapter="{chapter_id}" '
        + f'aria-expanded="false" aria-controls="chapter-comments-{chapter_id}">评论这一章</button></div>'
        + '<p class="like-save-note">喜欢会先记在当前浏览器。</p>'
        + comment_board_html(f"chapter-comments-{chapter_id}", f"/qiaorenzhen-story/chapter/{chapter_id}/", "读到这一章，你想说些什么？", hidden=True)
        + '</div>'
        + "</article>"
    )


def character_html(person: dict, index: int) -> str:
    seal = CHARACTER_SEALS[person["id"]]
    return (
        f'<article class="intro-card" data-character-id="{escape(person["id"])}" data-character-index="{index}" '
        f'data-character-seal="{escape(seal)}">'
        f'<div class="intro-portrait" role="img" aria-label="{escape(person["name"])}的彩色正脸像" '
        f'style="background-position-x:{index * 25}%"></div>'
        '<div class="intro-card-copy">'
        f'<span class="intro-number">{index + 1:02d} · {escape(person["age"])}岁</span>'
        f'<small>{escape(person["role"])}</small>'
        f'<div class="intro-name-row"><h3>{escape(person["name"])}</h3>'
        f'<span class="intro-name-seal" aria-hidden="true">{escape(seal)}</span></div>'
        f'<p>{escape(person["intro"])}</p>'
        '</div><button type="button" class="intro-card-flip" aria-pressed="false" hidden>'
        '翻看完整设定<span aria-hidden="true">↻</span></button></article>'
    )


def site_log_html(entries: list[dict]) -> str:
    items = []
    for entry in entries:
        date = entry["date"]
        if not re.fullmatch(r"\d{4}(?:-\d{2}-\d{2})?", date):
            raise ValueError(f"Invalid site log date: {date}")
        items.append(
            '<li><time datetime="' + escape(date) + '">' + escape(entry["label"]) + '</time>'
            '<div><strong>' + escape(entry["title"]) + '</strong>'
            '<p>' + escape(entry["summary"]) + '</p></div></li>'
        )
    return "\n".join(items)


def site_changelog_html(entries: list[dict]) -> str:
    items = []
    for entry in entries:
        timestamp = entry["timestamp"]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00", timestamp):
            raise ValueError(f"Invalid site changelog timestamp: {timestamp}")
        points = "".join(f"<li>{escape(point)}</li>" for point in entry["items"])
        items.append(
            '<li class="site-changelog-entry"><div class="site-changelog-entry-head">'
            f'<time datetime="{escape(timestamp)}">{escape(entry["label"])}</time>'
            f'<strong>{escape(entry["title"])}</strong></div>'
            f'<ul class="site-changelog-points">{points}</ul></li>'
        )
    return "\n".join(items)


def main() -> None:
    story = json.loads(STORY.read_text(encoding="utf-8"))
    site_log = json.loads(SITE_LOG.read_text(encoding="utf-8"))
    site_changelog = json.loads(SITE_CHANGELOG.read_text(encoding="utf-8"))
    chapters = story["chapters"]
    if len(chapters) < 17 or len({chapter["id"] for chapter in chapters}) != len(chapters):
        raise ValueError("Expected at least the 17 distinct public chapters in this edition")
    artwork = {art["chapterId"]: art for art in story["illustrations"]}
    characters = "\n".join(character_html(person, i) for i, person in enumerate(story["readerCharacters"]))
    rail = "\n".join(
        f'<a href="#{escape(chapter["id"])}"><span>{i:02d}</span>{escape(chapter["heading"])}</a>'
        for i, chapter in enumerate(chapters, 1)
    )
    content = "\n".join(chapter_html(chapter, i, artwork.get(chapter["id"])) for i, chapter in enumerate(chapters, 1))
    document = f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="花花、狗蛋和大黄共写的北宋茶馆故事。">
  <meta name="theme-color" content="#f7f2e8">
  <title>{escape(story["title"])} · 联文</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <link rel="stylesheet" href="{asset_url('style.css')}">
  <link rel="stylesheet" href="{asset_url('engagement.css')}">
  <link rel="stylesheet" href="{asset_url('author.css')}">
  <script>window.QIAORENZHEN_STORY_API_BASE = "{escape(STORY_API_BASE)}"; window.QIAORENZHEN_AUTHOR_API_BASE = "{escape(STORY_API_BASE)}";</script>
  <script src="{asset_url('site.js')}" defer></script>
  <script src="{asset_url('engagement.js')}" defer></script>
  <script src="{asset_url('author.js')}" defer></script>
</head>
<body>
<main class="site-shell" id="top">
  <div class="paper-grain" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="#top"><span class="brand-seal">半</span><span class="brand-text"><strong>{escape(story["title"])}</strong><small>三个人，一本慢慢写的故事</small></span></a>
    <nav class="reader-nav" aria-label="页面导航"><a href="#characters">人物初见</a><a href="#story-start">开始阅读</a>
      <span class="mode-nav" role="group" aria-label="阅读模式"><button type="button" class="active" data-story-mode="reader" aria-pressed="true">读者模式</button><button type="button" data-story-mode="author" aria-pressed="false">作者模式</button></span><button type="button" class="author-exit" id="author-exit" hidden>退出作者模式</button>
    </nav>
  </header>
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-art" role="img" aria-label="彩色水墨画里的宋代茶馆和故事人物"></div>
    <div class="hero-copy"><div class="eyebrow">汴京 · 茶馆 · 未完的故事</div>
      <h1 id="hero-title">来半日闲，<br><em>听一段</em>故事。</h1>
      <p>一间看起来寻常的茶馆，几位各怀心事的来客。有人在找人，有人在查案，也有人还没弄清自己为何被卷进来。</p>
      <div class="hero-actions"><a class="main-button" href="#story-start">开始阅读 <span aria-hidden="true">→</span></a>
        <button type="button" class="quiet-button story-like" aria-pressed="false"><span class="heart-mark" aria-hidden="true">♡</span> 喜欢这个故事</button></div>
      <p class="like-save-note">喜欢会先记在当前浏览器。</p>
    </div><div class="hero-stamp">故事<br>未完</div>
  </section>
  <section class="opening-log" id="site-log" aria-labelledby="site-log-title">
    <div class="opening-log-head"><div><div class="section-label"><span>开卷记录 · LOG</span><i></i></div>
      <h2 id="site-log-title">从旧稿，到现在。</h2></div>
      <a href="https://da1yuqin.github.io/blog/serial-fiction-making/">读制作手记 <span aria-hidden="true">↗</span></a></div>
    <ol class="opening-log-list">{site_log_html(site_log)}</ol>
    <details class="site-changelog" id="site-changelog">
      <summary><span class="site-changelog-summary"><span class="site-changelog-mark" aria-hidden="true">✦</span><strong>网站更新记录</strong><small>看看茶馆添了什么新东西</small></span><span class="site-changelog-arrow" aria-hidden="true">⌄</span></summary>
      <div class="site-changelog-scroll" role="region" aria-label="网站历史更新记录，可滚动查看" tabindex="0"><ol class="site-changelog-list">{site_changelog_html(site_changelog)}</ol></div>
    </details>
  </section>
  <section class="author-login" id="author-login" aria-labelledby="author-login-title" hidden>
    <div class="login-wrap"><div class="login-art" aria-hidden="true"><span>✧</span><span>卷</span><span>✧</span></div>
      <div class="login-card"><div class="section-label"><span>执笔人入口</span><i></i></div><h2 id="author-login-title">该你接着写了。</h2>
        <p>选好自己的头像，用专属口令进入作者模式。</p>
        <div class="author-choices" role="group" aria-label="选择作者"><button type="button" class="selected" data-author="huahua" aria-pressed="true"><span class="author-avatar author-avatar--huahua" role="img" aria-label="花花的头像"></span><strong>花花</strong></button><button type="button" data-author="goudan" aria-pressed="false"><span class="author-avatar author-avatar--goudan" role="img" aria-label="狗蛋的头像"></span><strong>狗蛋</strong></button><button type="button" data-author="dahuang" aria-pressed="false"><span class="author-avatar author-avatar--dahuang" role="img" aria-label="大黄的头像"></span><strong>大黄</strong></button></div>
        <form id="author-login-form"><label for="author-password"><span id="author-password-label">花花</span>的口令<input id="author-password" type="password" autocomplete="current-password" required maxlength="256" placeholder="输入你的口令"></label><button class="main-button" type="submit">进入作者模式 →</button></form>
        <p class="author-service-note" id="author-login-note" role="status"></p>
      </div>
    </div>
  </section>
  <section class="intro-section" id="characters" aria-labelledby="characters-title">
    <div class="section-label"><span>人物初见</span><i></i></div>
    <div class="intro-heading"><h2 id="characters-title">翻开故事前，<br>先认识他们。</h2><p>你将在茶馆与路途中遇到这些人。更多的事，留给正文慢慢说。</p></div>
    <div class="intro-grid">{characters}</div>
  </section>
  <div id="author-before-story" hidden></div>
  <div id="author-workshop" hidden></div>
  <section class="reading-section" id="story-start" aria-labelledby="story-title">
    <div class="reading-head"><div><div class="section-label"><span>正文</span><i></i></div><h2 id="story-title">故事，从这里开始。</h2></div><div class="reading-options"><span class="chapter-count">共 {len(chapters)} 段 · 持续连载</span><label class="chapter-author-option"><input type="checkbox" id="chapter-author-toggle" checked><span class="chapter-author-switch" aria-hidden="true"></span><span>显示作者</span></label></div></div>
    <div class="reading-layout"><aside class="chapter-rail"><span>卷页目录</span><div>{rail}</div></aside><div class="chapters">{content}</div></div>
  </section>
  <section class="reader-end"><div class="end-ornament">✦</div><p>后来的事，还要等下一位执笔的人。</p><button type="button" class="story-like" aria-pressed="false"><span class="heart-mark" aria-hidden="true">♡</span> 喜欢这个故事</button><span class="like-save-note">喜欢会先记在当前浏览器。</span></section>
  <section class="comments-section" id="story-comments" aria-labelledby="story-comments-title">
    <div class="section-label"><span>茶馆留言</span><i></i></div><h2 id="story-comments-title">留一句话吧。</h2>
    {comment_board_html('all-story-comments', '/qiaorenzhen-story/', '给整个故事留言', hidden=False)}
  </section>
  <footer class="site-footer"><span class="brand-seal">半</span><p>敲认真的故事 · 花花、狗蛋、大黄的联文茶馆</p><a href="#top">回到页首 ↑</a></footer>
</main>
<div class="popup-backdrop" id="like-popup" hidden><div class="like-popup" role="dialog" aria-modal="true" aria-labelledby="popup-title">
  <button type="button" class="popup-close" aria-label="关闭">×</button><div class="popup-spark">✦ · ✦ · ✦</div>
  <span class="author-avatar large author-avatar--huahua" role="img" aria-label="作者头像"></span>
  <span class="popup-eyebrow">从茶馆里探出头的是</span><h2 id="popup-title">花花</h2><p>谢谢你的喜欢，故事会继续写下去。</p>
  <div class="popup-authors" aria-label="三位作者"><button type="button" data-author="huahua" aria-label="花花"><span class="author-avatar tiny author-avatar--huahua"></span></button><button type="button" data-author="goudan" aria-label="狗蛋"><span class="author-avatar tiny author-avatar--goudan"></span></button><button type="button" data-author="dahuang" aria-label="大黄"><span class="author-avatar tiny author-avatar--dahuang"></span></button></div>
</div></div>
</body>
</html>
'''
    OUTPUT.write_text(document, encoding="utf-8")
    print(f"Built {OUTPUT.name}: {len(chapters)} chapters, {len(artwork)} illustrations")


if __name__ == "__main__":
    main()
