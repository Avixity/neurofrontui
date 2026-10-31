import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, Search } from "lucide-react";
import { getArticles, getArticle } from "../content";
import type { Locale } from "../i18n";
import type { Workspace } from "../useWorkspace";
import { Empty, PageHeading, type Translate } from "./ui";
export function Learn({
  t,
  locale,
  w,
  articleId,
  setArticleId,
}: {
  t: Translate;
  locale: Locale;
  w: Workspace;
  articleId: string | null;
  setArticleId: (id: string | null) => void;
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [onlySaved, setOnlySaved] = useState(false);
  const articles = useMemo(() => getArticles(locale), [locale]),
    article = articleId ? getArticle(locale, articleId) : null;
  const bookmark = (id: string) => {
    if (!w.session) {
      w.setError("learn.signInBookmark");
      return;
    }
    void w.bookmark(id).catch(() => w.setError("error.save"));
  };
  if (article)
    return (
      <article className="article">
        <button className="text-button" onClick={() => setArticleId(null)}>
          <ArrowLeft size={17} />
          {t("learn.allGuides")}
        </button>
        <PageHeading
          eyebrow={`${article.categoryLabel} / ${t("learn.readTime", { count: article.readMinutes })}`}
          title={article.title}
          description={article.summary}
          action={
            <button
              className="secondary"
              aria-pressed={w.bookmarks.includes(article.id)}
              onClick={() => bookmark(article.id)}
            >
              <Bookmark size={18} />
              {t(
                w.bookmarks.includes(article.id)
                  ? "learn.removeBookmark"
                  : "learn.bookmark",
              )}
            </button>
          }
        />
        {article.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
        <section className="source-list">
          <h3>{t("learn.sources")}</h3>
          {article.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {source.title}
              <ArrowUpRight size={16} />
            </a>
          ))}
        </section>
        <section>
          <h3>{t("learn.related")}</h3>
          {articles
            .filter(
              (a) => a.category === article.category && a.id !== article.id,
            )
            .map((a) => (
              <button
                key={a.id}
                className="guide-link"
                onClick={() => setArticleId(a.id)}
              >
                {a.title}
                <ArrowUpRight size={17} />
              </button>
            ))}
        </section>
      </article>
    );
  const results = articles.filter(
    (a) =>
      (category === "all" || a.category === category) &&
      (!onlySaved || w.bookmarks.includes(a.id)) &&
      `${a.title} ${a.summary}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow={`03 / ${t("nav.learn")}`}
        title={t("learn.title")}
        description={t("learn.description")}
      />
      <div className="learn-toolbar">
        <label className="search-field">
          <Search size={19} />
          <span className="sr-only">{t("learn.search")}</span>
          <input
            type="search"
            placeholder={t("learn.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          aria-pressed={onlySaved}
          onClick={() => setOnlySaved(!onlySaved)}
        >
          <Bookmark size={17} />
          {t("learn.bookmarks")}
        </button>
      </div>
      <div className="topic-tabs" aria-label={t("learn.categories")}>
        <button
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          {t("common.all")}
        </button>
        {Array.from(
          new Map(articles.map((a) => [a.category, a.categoryLabel])),
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="article-grid">
        {results.map((a, i) => (
          <article key={a.id}>
            <span className="eyebrow">
              {String(i + 1).padStart(2, "0")} / {a.categoryLabel}
            </span>
            <button className="article-open" onClick={() => setArticleId(a.id)}>
              <h2>{a.title}</h2>
              <ArrowUpRight size={23} />
            </button>
            <p>{a.summary}</p>
            <footer>
              <span>{t("learn.readTime", { count: a.readMinutes })}</span>
              <button
                className="icon-button"
                aria-label={t(
                  w.bookmarks.includes(a.id)
                    ? "learn.removeBookmark"
                    : "learn.bookmark",
                )}
                aria-pressed={w.bookmarks.includes(a.id)}
                onClick={() => bookmark(a.id)}
              >
                <Bookmark size={18} />
              </button>
            </footer>
          </article>
        ))}
      </div>
      {!results.length && <Empty title={t("learn.noResults")} />}
    </>
  );
}
