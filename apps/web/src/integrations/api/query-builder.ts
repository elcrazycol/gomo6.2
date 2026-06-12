// Query builder module — api.from() compatible with Go backend
// Provides the fluent query builder API: .select(), .eq(), .order(), .single(), etc.
import { apiClient } from './client';

// ── Real-time channels (placeholder) ──────────────────────────────────────────

export const channel = (_name: string) => ({
  on: (_event: string, _config: unknown, _callback: unknown) => ({
    subscribe: () => ({ unsubscribe: () => {} })
  })
});

export const removeChannel = (_ch: unknown) => {};

// ── Shared helpers ────────────────────────────────────────────────────────────

type Filter = { type: string; column: string; value: unknown; operator?: string };
type QueryState = {
  select: string;
  selectOptions: null | { count?: string; head?: boolean };
  filters: Filter[];
  orConditions: string[];
  order: { column: string; ascending: boolean }[];
  limit: number | null;
  offset: number | null;
};

// ── Response types ────────────────────────────────────────────────────────────

interface QueryResponse {
  data: Record<string, unknown>[] | null;
  error: unknown;
  count?: number;
}

interface SingleResponse {
  data: Record<string, unknown> | null;
  error: unknown;
  count?: number;
}

interface SelectQueryBuilder {
  eq: (c: string, v: unknown) => SelectQueryBuilder;
  neq: (c: string, v: unknown) => SelectQueryBuilder;
  is: (c: string, v: unknown) => SelectQueryBuilder;
  in: (c: string, v: unknown[]) => SelectQueryBuilder;
  like: (c: string, p: string) => SelectQueryBuilder;
  ilike: (c: string, p: string) => SelectQueryBuilder;
  gt: (c: string, v: unknown) => SelectQueryBuilder;
  gte: (c: string, v: unknown) => SelectQueryBuilder;
  lt: (c: string, v: unknown) => SelectQueryBuilder;
  lte: (c: string, v: unknown) => SelectQueryBuilder;
  not: (c: string, o: string, v: unknown) => SelectQueryBuilder;
  or: (c: string) => SelectQueryBuilder;
  order: (c: string, opts?: { ascending?: boolean }) => SelectQueryBuilder;
  limit: (n: number) => SelectQueryBuilder;
  range: (from: number, to?: number) => SelectQueryBuilder;
  single: () => Promise<SingleResponse>;
  maybeSingle: () => Promise<SingleResponse>;
  then: <TResult = SingleResponse>(cb: (value: QueryResponse) => TResult) => Promise<TResult>;
}

interface MutationBuilder {
  eq: (c: string, v: unknown) => MutationBuilder;
  neq: (c: string, v: unknown) => MutationBuilder;
  is: (c: string, v: unknown) => MutationBuilder;
  in: (c: string, v: unknown[]) => MutationBuilder;
  like: (c: string, p: string) => MutationBuilder;
  ilike: (c: string, p: string) => MutationBuilder;
  gt: (c: string, v: unknown) => MutationBuilder;
  gte: (c: string, v: unknown) => MutationBuilder;
  lt: (c: string, v: unknown) => MutationBuilder;
  lte: (c: string, v: unknown) => MutationBuilder;
  not: (c: string, o: string, v: unknown) => MutationBuilder;
  or: (c: string) => MutationBuilder;
  select: (cols?: string) => MutationBuilder;
  single: () => Promise<SingleResponse>;
  maybeSingle: () => Promise<SingleResponse>;
  then: <TResult = SingleResponse>(cb: (value: QueryResponse) => TResult) => Promise<TResult>;
}

interface InsertBuilder {
  select: (cols?: string) => InsertBuilder;
  single: () => Promise<SingleResponse>;
  maybeSingle: () => Promise<SingleResponse>;
  then: <TResult = SingleResponse>(cb: (value: QueryResponse) => TResult) => Promise<TResult>;
}

interface TableApi {
  select: (cols?: string, opts?: { count?: string; head?: boolean } | null) => SelectQueryBuilder;
  insert: (data: Record<string, unknown>) => InsertBuilder;
  update: (data: Record<string, unknown>) => MutationBuilder;
  delete: () => MutationBuilder;
  upsert: (data: Record<string, unknown>) => InsertBuilder;
}

const encodeValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

/** Serialises query-state filters + orConditions + select into URLSearchParams. */
const buildFilterParams = (q: QueryState, params: URLSearchParams) => {
  q.filters.forEach((f) => {
    if (f.type === 'eq')       params.append(f.column, `eq.${encodeValue(f.value)}`);
    else if (f.type === 'neq') params.append(f.column, `neq.${encodeValue(f.value)}`);
    else if (f.type === 'is')  params.append(f.column, `is.${encodeValue(f.value)}`);
    else if (f.type === 'like')  params.append(f.column, `like.${encodeValue(f.value)}`);
    else if (f.type === 'ilike') params.append(f.column, `ilike.${encodeValue(f.value)}`);
    else if (f.type === 'gt')  params.append(f.column, `gt.${encodeValue(f.value)}`);
    else if (f.type === 'gte') params.append(f.column, `gte.${encodeValue(f.value)}`);
    else if (f.type === 'lt')  params.append(f.column, `lt.${encodeValue(f.value)}`);
    else if (f.type === 'lte') params.append(f.column, `lte.${encodeValue(f.value)}`);
    else if (f.type === 'in') {
      const vals = Array.isArray(f.value) ? f.value : [f.value];
      params.append(f.column, `in.(${vals.map(encodeValue).join(',')})`);
    }
    else if (f.type === 'not') params.append(f.column, `not.${f.operator}.${encodeValue(f.value)}`);
  });

  if (q.orConditions.length > 0) params.append('or', q.orConditions.join(','));
  if (q.select !== '*')          params.set('select', q.select);
};

/** Removes the eq.id filter from state and returns its value. */
const popIdFilter = (q: QueryState): string | undefined => {
  const idx = q.filters.findIndex((f) => f.type === 'eq' && f.column === 'id');
  if (idx === -1) return undefined;
  const val = q.filters[idx].value;
  q.filters.splice(idx, 1);
  return val as string | undefined;
};

// ── Query builder ─────────────────────────────────────────────────────────────

export const from = (table: string): TableApi => {
  const queryState: QueryState = {
    select: '*',
    selectOptions: null,
    filters: [],
    orConditions: [],
    order: [],
    limit: null,
    offset: null,
  };

  const buildQuery = () => {
    const params = new URLSearchParams();
    buildFilterParams(queryState, params);

    if (queryState.order.length > 0) {
      params.set(
        'order',
        queryState.order
          .map((o) => `${o.column}.${o.ascending ? 'asc' : 'desc'}`)
          .join(',')
      );
    }
    if (queryState.limit)  params.set('limit', String(queryState.limit));
    if (queryState.offset) params.set('offset', String(queryState.offset));

    const qs = params.toString();
    return `/api/v1/${table}${qs ? `?${qs}` : ''}`;
  };

  const executeQuery = async (method = 'GET', body?: Record<string, unknown>): Promise<QueryResponse> => {
    let url: string;

    // ── PUT with id filter → PUT /table/:id for known tables ───────────
    // NOTE: Add new tables here when they need PUT support via query builder.
    if (method === 'PUT' && ['profiles', 'boards', 'threads', 'posts', 'user_session_time', 'user_daily_visits', 'privacy_settings', 'gomosub_memberships', 'gomosub_rules_acceptance', 'user_roles', 'user_achievements'].includes(table)) {
      const idVal = popIdFilter(queryState);
      if (idVal !== undefined) {
        url = `/api/v1/${table}/${encodeURIComponent(String(idVal))}`;
        const params = new URLSearchParams();
        buildFilterParams(queryState, params);
        url += params.toString() ? `?${params}` : '';
      } else {
        url = buildQuery();
      }
    }

    // ── POST routes without id ─────────────────────────────────────────
    else if (method === 'POST' && ['posts', 'threads', 'boards'].includes(table)) {
      url = `/api/v1/${table}`;
      const params = new URLSearchParams();
      if (queryState.select !== '*') params.set('select', queryState.select);
      url += params.toString() ? `?${params}` : '';
    }

    // ── Likes ──────────────────────────────────────────────────────────
    else if (table === 'thread_likes' && method === 'POST' && body?.thread_id) {
      url = `/api/v1/threads/${encodeURIComponent(String(body.thread_id))}/like`;
    }
    else if (table === 'post_likes' && method === 'POST' && body?.post_id) {
      url = `/api/v1/posts/${encodeURIComponent(String(body.post_id))}/like`;
    }
    else if (table === 'thread_likes' && method === 'DELETE') {
      const tid = queryState.filters.find((f) => f.type === 'eq' && f.column === 'thread_id');
      url = tid?.value
        ? `/api/v1/threads/${encodeURIComponent(String(tid.value))}/like`
        : buildQuery();
    }
    else if (table === 'post_likes' && method === 'DELETE') {
      const pid = queryState.filters.find((f) => f.type === 'eq' && f.column === 'post_id');
      url = pid?.value
        ? `/api/v1/posts/${encodeURIComponent(String(pid.value))}/like`
        : buildQuery();
    }

    // ── Default: GET / DELETE / POST / PUT without special handling ────
    else {
      url = buildQuery();
    }

    const options: RequestInit = { method };
    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
      options.headers = { 'Content-Type': 'application/json' };
    }

    const response = await apiClient.rawRequest(url, options);

    // Handle count mode
    if (queryState.selectOptions?.count === 'exact') {
      const list = Array.isArray(response.data)
        ? response.data
        : response.data
          ? [response.data]
          : [];
      if (queryState.selectOptions.head) return { ...response, data: null, count: list.length } as unknown as QueryResponse;
      return { ...response, count: list.length } as unknown as QueryResponse;
    }
    return response as unknown as QueryResponse;
  };

  const flattenSingleResponse = (r: QueryResponse): SingleResponse => {
    const data = r.data;
    if (Array.isArray(data)) {
      return data.length === 1 ? { ...r, data: data[0] as Record<string, unknown> } : { ...r, data: null };
    }
    // Non-array: backend returned a single object (e.g., POST insert response)
    return { ...r, data: data as Record<string, unknown> | null };
  };

  const flattenMaybeSingleResponse = (r: QueryResponse): SingleResponse => {
    const data = r.data;
    if (Array.isArray(data)) {
      return data.length > 0 ? { ...r, data: data[0] as Record<string, unknown> } : { ...r, data: null };
    }
    // Non-array: backend returned a single object (e.g., POST insert response)
    return { ...r, data: data as Record<string, unknown> | null };
  };

  // ── Mutation builder (PUT / DELETE) ──────────────────────────────────
  const createMutationBuilder = (method: 'PUT' | 'DELETE', data?: Record<string, unknown>): MutationBuilder => {
    const builder: MutationBuilder = {
      eq:   (c, v)    => { queryState.filters.push({ type: 'eq', column: c, value: v }); return builder; },
      neq:  (c, v)    => { queryState.filters.push({ type: 'neq', column: c, value: v }); return builder; },
      is:   (c, v)    => { queryState.filters.push({ type: 'is', column: c, value: v }); return builder; },
      in:   (c, v)  => { queryState.filters.push({ type: 'in', column: c, value: v }); return builder; },
      like: (c, p)    => { queryState.filters.push({ type: 'like', column: c, value: p }); return builder; },
      ilike:(c, p)    => { queryState.filters.push({ type: 'ilike', column: c, value: p }); return builder; },
      gt:   (c, v)    => { queryState.filters.push({ type: 'gt', column: c, value: v }); return builder; },
      gte:  (c, v)    => { queryState.filters.push({ type: 'gte', column: c, value: v }); return builder; },
      lt:   (c, v)    => { queryState.filters.push({ type: 'lt', column: c, value: v }); return builder; },
      lte:  (c, v)    => { queryState.filters.push({ type: 'lte', column: c, value: v }); return builder; },
      not:  (c, o, v) => { queryState.filters.push({ type: 'not', column: c, operator: o, value: v }); return builder; },
      or:   (c)       => { queryState.orConditions.push(c); return builder; },
      select: (cols = '*') => { queryState.select = cols; return builder; },
      single: () => executeQuery(method, data).then(flattenMaybeSingleResponse),
      maybeSingle: () => executeQuery(method, data).then(flattenMaybeSingleResponse),
      then: <TResult>(cb: (value: QueryResponse) => TResult) => executeQuery(method, data).then(cb),
    };
    return builder;
  };

  // ── Insert builder (POST) ────────────────────────────────────────────
  const createInsertBuilder = (data: Record<string, unknown>): InsertBuilder => {
    const builder: InsertBuilder = {
      select: (cols = '*') => { queryState.select = cols; return builder; },
      single: () => executeQuery('POST', data).then(flattenMaybeSingleResponse),
      maybeSingle: () => executeQuery('POST', data).then(flattenMaybeSingleResponse),
      then: <TResult>(cb: (value: QueryResponse) => TResult) => executeQuery('POST', data).then(cb),
    };
    return builder;
  };

  // ── Query builder (GET) ────────────────────────────────────────────
  function createQueryBuilder(): SelectQueryBuilder {
    const b: SelectQueryBuilder = {
      eq:   (c, v)    => { queryState.filters.push({ type: 'eq', column: c, value: v }); return b; },
      neq:  (c, v)    => { queryState.filters.push({ type: 'neq', column: c, value: v }); return b; },
      is:   (c, v)    => { queryState.filters.push({ type: 'is', column: c, value: v }); return b; },
      in:   (c, v)  => { queryState.filters.push({ type: 'in', column: c, value: v }); return b; },
      like: (c, p)    => { queryState.filters.push({ type: 'like', column: c, value: p }); return b; },
      ilike:(c, p)    => { queryState.filters.push({ type: 'ilike', column: c, value: p }); return b; },
      gt:   (c, v)    => { queryState.filters.push({ type: 'gt', column: c, value: v }); return b; },
      gte:  (c, v)    => { queryState.filters.push({ type: 'gte', column: c, value: v }); return b; },
      lt:   (c, v)    => { queryState.filters.push({ type: 'lt', column: c, value: v }); return b; },
      lte:  (c, v)    => { queryState.filters.push({ type: 'lte', column: c, value: v }); return b; },
      not:  (c, o, v) => { queryState.filters.push({ type: 'not', column: c, operator: o, value: v }); return b; },
      or:   (c)       => { queryState.orConditions.push(c); return b; },
      order: (c, opts) => { queryState.order.push({ column: c, ascending: opts?.ascending ?? true }); return b; },
      limit: (n)       => { queryState.limit = n; return b; },
      range: (from, to) => {
        queryState.offset = from;
        if (to !== undefined) queryState.limit = Math.max(0, to - from + 1);
        return b;
      },
      single: () => executeQuery().then(flattenSingleResponse),
      maybeSingle: () => executeQuery().then(flattenMaybeSingleResponse),
      then: <TResult>(cb: (value: QueryResponse) => TResult) => executeQuery().then(cb),
    };
    return b;
  }

  // ── Public API ───────────────────────────────────────────────────────
  const base: TableApi = {
    select: (cols = '*', opts?: { count?: string; head?: boolean } | null) => {
      queryState.select = cols;
      queryState.selectOptions = opts ?? null;
      return createQueryBuilder();
    },
    insert: (data: Record<string, unknown>) => {
      queryState.select = '*';
      return createInsertBuilder(data);
    },
    update: (data: Record<string, unknown>) => createMutationBuilder('PUT', data),
    delete: () => createMutationBuilder('DELETE'),
    upsert: (data: Record<string, unknown>) => createInsertBuilder(data),
  };

  return base;
};
