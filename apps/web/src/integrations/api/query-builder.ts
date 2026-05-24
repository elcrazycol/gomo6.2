// Query builder module — supabase.from() compatibility backed by Go backend
// Provides the fluent query builder API: .select(), .eq(), .order(), .single(), etc.
import { apiClient } from './client';

// ── Real-time channels (placeholder) ──────────────────────────────────────────

export const channel = (_name: string) => ({
  on: (_event: string, _config: any, _callback: any) => ({
    subscribe: () => ({ unsubscribe: () => {} })
  })
});

export const removeChannel = (_ch: any) => {};

// ── Shared helpers ────────────────────────────────────────────────────────────

type Filter = { type: string; column: string; value: any; operator?: string };
type QueryState = {
  select: string;
  selectOptions: null | { count?: string; head?: boolean };
  filters: Filter[];
  orConditions: string[];
  order: { column: string; ascending: boolean }[];
  limit: number | null;
  offset: number | null;
};

const encodeValue = (value: any): string => {
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
  return val;
};

// ── Query builder ─────────────────────────────────────────────────────────────

export const from = (table: string) => {
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

  const executeQuery = async (method = 'GET', body?: any) => {
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
      if (queryState.selectOptions.head) return { ...response, data: null, count: list.length };
      return { ...response, count: list.length };
    }
    return response;
  };

  // ── Mutation builder (PUT / DELETE) ──────────────────────────────────
  const createMutationBuilder = (method: 'PUT' | 'DELETE', data?: any) => {
    const builder: any = {
      eq:   (c: string, v: any)    => { queryState.filters.push({ type: 'eq', column: c, value: v }); return builder; },
      in:   (c: string, v: any[])  => { queryState.filters.push({ type: 'in', column: c, value: v }); return builder; },
      neq:  (c: string, v: any)    => { queryState.filters.push({ type: 'neq', column: c, value: v }); return builder; },
      is:   (c: string, v: any)    => { queryState.filters.push({ type: 'is', column: c, value: v }); return builder; },
      not:  (c: string, o: string, v: any) => { queryState.filters.push({ type: 'not', column: c, operator: o, value: v }); return builder; },
      or:   (c: string)            => { queryState.orConditions.push(c); return builder; },
      select: (cols = '*')         => { queryState.select = cols; return builder; },
      single: () => executeQuery(method, data).then((r: any) =>
        r.data?.length > 0 ? { ...r, data: r.data[0] } : r),
      maybeSingle: () => executeQuery(method, data).then((r: any) =>
        r.data?.length > 0 ? { ...r, data: r.data[0] } : { ...r, data: null }),
      then: (cb: any) => executeQuery(method, data).then(cb),
    };
    return builder;
  };

  // ── Insert builder (POST) ────────────────────────────────────────────
  const createInsertBuilder = (data: any) => {
    const builder: any = {
      select: (cols = '*') => { queryState.select = cols; return builder; },
      single: () => executeQuery('POST', data).then((r: any) =>
        r.data?.length > 0 ? { ...r, data: r.data[0] } : r),
      maybeSingle: () => executeQuery('POST', data).then((r: any) =>
        r.data?.length > 0 ? { ...r, data: r.data[0] } : { ...r, data: null }),
      then: (cb: any) => executeQuery('POST', data).then(cb),
    };
    return builder;
  };

  // ── Public API ───────────────────────────────────────────────────────
  const base: any = {
    select: (cols = '*', opts?: { count?: string; head?: boolean }) => {
      queryState.select = cols;
      queryState.selectOptions = opts ?? null;
      return createQueryBuilder();
    },
    insert: (data: any) => {
      queryState.select = '*';
      return createInsertBuilder(data);
    },
    update: (data: any) => createMutationBuilder('PUT', data),
    delete: () => createMutationBuilder('DELETE'),
    upsert: (data: any) => createInsertBuilder(data),
  };

  return base;

  // ── Query builder (GET) ────────────────────────────────────────────
  function createQueryBuilder() {
    const b: any = {
      eq:   (c: string, v: any)    => { queryState.filters.push({ type: 'eq', column: c, value: v }); return b; },
      in:   (c: string, v: any[])  => { queryState.filters.push({ type: 'in', column: c, value: v }); return b; },
      neq:  (c: string, v: any)    => { queryState.filters.push({ type: 'neq', column: c, value: v }); return b; },
      is:   (c: string, v: any)    => { queryState.filters.push({ type: 'is', column: c, value: v }); return b; },
      not:  (c: string, o: string, v: any) => { queryState.filters.push({ type: 'not', column: c, operator: o, value: v }); return b; },
      or:   (c: string)            => { queryState.orConditions.push(c); return b; },
      order: (c: string, opts?: { ascending?: boolean }) => { queryState.order.push({ column: c, ascending: opts?.ascending ?? true }); return b; },
      limit: (n: number)           => { queryState.limit = n; return b; },
      range: (from: number, to?: number) => {
        queryState.offset = from;
        if (to !== undefined) queryState.limit = Math.max(0, to - from + 1);
        return b;
      },
      single: () => executeQuery().then((r: any) =>
        r.data?.length === 1 ? { ...r, data: r.data[0] } : { ...r, data: null }),
      maybeSingle: () => executeQuery().then((r: any) =>
        r.data?.length > 0 ? { ...r, data: r.data[0] } : { ...r, data: null }),
      then: (cb: any) => executeQuery().then(cb),
    };
    return b;
  }
};
