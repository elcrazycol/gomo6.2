import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { searchGlobal, type GlobalSearchResult } from "@/utils/globalSearch";
import { Loader2, Search } from "lucide-react";

const SearchResults = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentQuery = (searchParams.get("q") || "").trim();
  const [queryDraft, setQueryDraft] = useState(currentQuery);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult>({ users: [], gomosubs: [], threads: [] });

  useEffect(() => {
    setQueryDraft(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    const run = async () => {
      if (currentQuery.length < 2) {
        setResults({ users: [], gomosubs: [], threads: [] });
        return;
      }
      setLoading(true);
      const data = await searchGlobal(currentQuery, { users: 24, gomosubs: 24, threads: 60 });
      setResults(data);
      setLoading(false);
    };

    run();
  }, [currentQuery]);

  const total = useMemo(
    () => results.users.length + results.gomosubs.length + results.threads.length,
    [results]
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const term = queryDraft.trim();
    setSearchParams(term.length >= 2 ? { q: term } : {});
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="relative flex gap-2">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Поиск: пользователь, g-саб или тред"
              className="pl-9"
            />
            <Button type="submit">Найти</Button>
          </form>
          <div className="mt-3 text-sm text-muted-foreground">
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
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Пользователи</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {results.users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ничего не найдено</p>
                ) : (
                  results.users.map((user) => (
                    <Link
                      key={user.id}
                      to={`/profile/${user.id}`}
                      className="block p-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
                    >
                      @{user.username}
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">G-сабы</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {results.gomosubs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ничего не найдено</p>
                ) : (
                  results.gomosubs.map((sub) => (
                    <Link
                      key={sub.id}
                      to={`/g/${sub.slug}`}
                      className="block p-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="font-medium">g/{sub.slug}</div>
                      <div className="text-sm text-muted-foreground">{sub.name}</div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Треды</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ничего не найдено</p>
              ) : (
                results.threads.map((thread) => (
                  <Link
                    key={thread.id}
                    to={`${thread.boards?.is_gomosub ? "/g" : ""}/${thread.boards?.slug}/thread/${thread.id}`}
                    className="block p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="text-sm text-muted-foreground mb-1">
                      {thread.boards?.is_gomosub ? "g" : ""}/{thread.boards?.slug}/
                    </div>
                    <div className="font-medium">{thread.title}</div>
                    <div className="text-sm text-muted-foreground line-clamp-2 mt-1">{thread.content}</div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default SearchResults;
