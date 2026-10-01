import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HighlightText } from "@/components/search/HighlightText";
import { searchGlobal, type GlobalSearchResult, type SearchFilters } from "@/utils/globalSearch";
import { Loader2, Search, X } from "lucide-react";
import { entityParam, profileUrl, wallPostUrl } from "@/utils/entityUrl";

const TYPE_OPTIONS = [
  { value: "users", label: "Люди" },
  { value: "boards", label: "Доски" },
  { value: "threads", label: "Записи" },
  { value: "posts", label: "Посты" },
  { value: "wall_posts", label: "Стена" },
] as const;

const SINCE_OPTIONS = [
  { value: "any", label: "За всё время" },
  { value: "24h", label: "За сутки" },
  { value: "7d", label: "За неделю" },
  { value: "30d", label: "За месяц" },
  { value: "1y", label: "За год" },
] as const;

const SORT_OPTIONS = [
  { value: "relevance", label: "По релевантности" },
  { value: "recent", label: "Сначала новые" },
] as const;

const EMPTY: GlobalSearchResult = { users: [], boards: [], threads: [], posts: [], wall_posts: [] };

const SearchResults = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentQuery = (searchParams.get("q") || "").trim();
  const typeParam = searchParams.get("type") || "";
  const sortParam = searchParams.get("sort") || "";
  const sinceParam = searchParams.get("since") || "";
  const authorParam = searchParams.get("author") || "";

  const [queryDraft, setQueryDraft] = useState(currentQuery);
  const [authorDraft, setAuthorDraft] = useState(authorParam);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult>(EMPTY);

  const activeTypes = useMemo(
    () => typeParam.split(",").map((t) => t.trim()).filter(Boolean),
    [typeParam]
  );
  const hasFilters = activeTypes.length > 0 || !!sortParam || !!sinceParam || !!authorParam;

  useEffect(() => {
    setQueryDraft(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    setAuthorDraft(authorParam);
  }, [authorParam]);

  // Filters live in the URL, so a link to a filtered search is shareable and the
  // query re-runs whenever any of them changes.
  useEffect(() => {
    const run = async () => {
      if (currentQuery.length < 2) {
        setResults(EMPTY);
        return;
      }
      setLoading(true);
      const filters: SearchFilters = {
        types: typeParam ? typeParam.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        author: authorParam || undefined,
        since: sinceParam || undefined,
        sort: sortParam === "recent" ? "recent" : undefined,
      };
      const data = await searchGlobal(
        currentQuery,
        { users: 24, boards: 24, threads: 60, posts: 30, wall_posts: 30 },
        filters
      );
      setResults(data);
      setLoading(false);
    };

    run();
  }, [currentQuery, typeParam, sortParam, sinceParam, authorParam]);

  const total = useMemo(
    () => results.users.length + results.boards.length + results.threads.length + results.posts.length + results.wall_posts.length,
    [results]
  );

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const toggleType = (value: string) => {
    const set = new Set(activeTypes);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    updateParam("type", Array.from(set).join(","));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const term = queryDraft.trim();
    if (term.length >= 2) next.set("q", term);
    else next.delete("q");

    const author = authorDraft.trim();
    if (author) next.set("author", author);
    else next.delete("author");

    setSearchParams(next);
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <form onSubmit={submit} className="relative flex gap-2">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Поиск: пользователь, доска, g-саб, запись..."
              className="pl-9"
            />
            <Button type="submit">Найти</Button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            {TYPE_OPTIONS.map((option) => {
              const active = activeTypes.includes(option.value);
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => toggleType(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}

            <Select
              value={sinceParam || "any"}
              onValueChange={(value) => updateParam("since", value === "any" ? "" : value)}
            >
              <SelectTrigger className="h-8 w-[150px] rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SINCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sortParam || "relevance"}
              onValueChange={(value) => updateParam("sort", value === "relevance" ? "" : value)}
            >
              <SelectTrigger className="h-8 w-[170px] rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={authorDraft}
              onChange={(e) => setAuthorDraft(e.target.value)}
              placeholder="Автор (ник)"
              className="h-8 w-[160px] rounded-full"
              aria-label="Фильтр по автору"
            />

            {hasFilters && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-full text-muted-foreground"
                onClick={() => setSearchParams(currentQuery ? { q: currentQuery } : {})}
              >
                <X className="w-3 h-3 mr-1" />
                Сбросить
              </Button>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            {currentQuery.length >= 2 ? `Запрос: ${currentQuery}` : "Введи минимум 2 символа"}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : currentQuery.length < 2 ? null : (
        <>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Результатов: {total}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Users */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Пользователи ({results.users.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {results.users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ничего не найдено</p>
                ) : (
                  results.users.map((user) => (
                    <Link
                      key={user.id}
                      to={profileUrl(user)}
                      className="block p-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
                    >
                      @<HighlightText text={user.username} query={currentQuery} />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Boards + GomoSubs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Доски и G-сабы ({results.boards.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {results.boards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ничего не найдено</p>
                ) : (
                  results.boards.map((b) => {
                    const isGomo = b.is_gomosub;
                    const link = isGomo ? `/g/${b.slug}` : `/${b.slug}`;
                    const prefix = isGomo ? "g/" : "/";
                    return (
                      <Link
                        key={b.id}
                        to={link}
                        className="block p-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
                      >
                        <div className="font-medium">{prefix}{b.slug}</div>
                        <div className="text-sm text-muted-foreground">
                          <HighlightText text={b.name} query={currentQuery} />
                        </div>
                      </Link>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Threads */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Записи ({results.threads.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ничего не найдено</p>
              ) : (
                results.threads.map((thread) => {
                  const isGomo = thread.board_is_gomosub && thread.board_slug;
                  const link = isGomo
                    ? `/g/${thread.board_slug}/thread/${entityParam(thread)}`
                    : `/thread/${entityParam(thread)}`;
                  return (
                    <Link
                      key={thread.id}
                      to={link}
                      className="block p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
                    >
                      {thread.board_slug && (
                        <div className="text-sm text-muted-foreground mb-1">
                          {isGomo ? "g/" : "/"}{thread.board_slug}/ — {thread.board_name}
                        </div>
                      )}
                      <div className="font-medium">
                        <HighlightText text={thread.title} query={currentQuery} />
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        <HighlightText text={thread.content} query={currentQuery} />
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Posts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Посты ({results.posts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.posts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ничего не найдено</p>
              ) : (
                results.posts.map((post) => {
                  const isGomo = post.board_is_gomosub && post.board_slug;
                  const link = isGomo
                    ? `/g/${post.board_slug}/thread/${entityParam({ id: post.thread_id, public_id: post.thread_public_id })}`
                    : `/thread/${entityParam({ id: post.thread_id, public_id: post.thread_public_id })}`;
                  return (
                    <Link
                      key={post.id}
                      to={link}
                      className="block p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-sm text-muted-foreground mb-1">
                        {post.board_slug ? `${isGomo ? "g/" : "/"}${post.board_slug}/` : ""}
                        <HighlightText text={post.thread_title} query={currentQuery} />
                        {post.username && <> — @<HighlightText text={post.username} query={currentQuery} /></>}
                      </div>
                      <div className="text-sm line-clamp-3">
                        <HighlightText text={post.content} query={currentQuery} />
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Wall posts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Записи на стене ({results.wall_posts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.wall_posts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ничего не найдено</p>
              ) : (
                results.wall_posts.map((post) => {
                  const link = wallPostUrl(
                    { id: post.wall_user_id },
                    { id: post.id, public_id: post.public_id }
                  );
                  return (
                    <Link
                      key={post.id}
                      to={link}
                      className="block p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-sm text-muted-foreground mb-1">
                        {post.author_username && (
                          <>@<HighlightText text={post.author_username} query={currentQuery} /></>
                        )}
                        {post.wall_username && (
                          <> на стене @<HighlightText text={post.wall_username} query={currentQuery} /></>
                        )}
                      </div>
                      {post.title && (
                        <div className="font-medium">
                          <HighlightText text={post.title} query={currentQuery} />
                        </div>
                      )}
                      <div className="text-sm line-clamp-3">
                        <HighlightText text={post.content} query={currentQuery} />
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default SearchResults;
