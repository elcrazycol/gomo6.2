// Simple API Client for Go Backend
import { apiClient, API_BASE_URL, API_KEY } from './client';

// Direct Supabase replacement - simplified version
export const supabase = {
  // Auth
  auth: {
    signUp: async ({ email, password, options }: any) => {
      try {
        const result = await apiClient.register(email, options?.data?.username || email.split('@')[0], password);
        return { data: { user: result.user, session: { access_token: result.token } }, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
    signInWithPassword: async ({ email, password }: any) => {
      try {
        const result = await apiClient.login(email, password);
        return { data: { user: result.user, session: { access_token: result.token } }, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
    signOut: async () => {
      apiClient.logout();
      return { error: null };
    },
    getUser: async () => {
      try {
        const user = await apiClient.getCurrentUser();
        return { data: { user }, error: null };
      } catch (error) {
        return { data: { user: null }, error: { message: (error as Error).message } };
      }
    },
    getSession: async () => {
      try {
        const user = await apiClient.getCurrentUser();
        return { data: { session: user ? { user, access_token: localStorage.getItem('auth_token') } : null }, error: null };
      } catch (error) {
        return { data: { session: null }, error: { message: (error as Error).message } };
      }
    },
    onAuthStateChange: (callback: any) => {
      const checkAuth = async () => {
        const user = await apiClient.getCurrentUser();
        callback('SIGNED_IN', user ? { user } : null);
      };
      
      checkAuth();
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    updateUser: async (attrs: { password?: string }) => {
      try {
        if (attrs?.password) {
          await apiClient.updatePassword(attrs.password);
          const user = await apiClient.getCurrentUser();
          return { data: { user }, error: null };
        }
        return { data: { user: null }, error: { message: 'Поддерживается только смена пароля (password)' } };
      } catch (error) {
        return { data: { user: null }, error: { message: (error as Error).message } };
      }
    },
  },

  // Real-time channels (placeholder)
  channel: (name: string) => ({
    on: (event: string, config: any, callback: any) => ({
      subscribe: () => ({ unsubscribe: () => {} })
    })
  }),
  removeChannel: (channel: any) => {},

  // Database - simplified but complete implementation
  from: (table: string) => {
    let queryState: any = {
      select: '*',
      selectOptions: null as null | { count?: string; head?: boolean },
      filters: [] as Array<{ type: string; column: string; value: any; operator?: string }>,
      orConditions: [] as string[],
      order: [] as Array<{ column: string; ascending: boolean }>,
      limit: null,
      offset: null
    };
    
    const encodeValue = (value: any): string => {
      if (value === null) return 'null';
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      return String(value);
    };
    
    const buildQuery = () => {
      const params = new URLSearchParams();
      
      // Select
      if (queryState.select !== '*') {
        params.set('select', queryState.select);
      }
      
      // Filters
      queryState.filters.forEach((filter: any) => {
        if (filter.type === 'eq') {
          params.append(filter.column, `eq.${encodeValue(filter.value)}`);
        } else if (filter.type === 'neq') {
          params.append(filter.column, `neq.${encodeValue(filter.value)}`);
        } else if (filter.type === 'is') {
          params.append(filter.column, `is.${encodeValue(filter.value)}`);
        } else if (filter.type === 'in') {
          const values = Array.isArray(filter.value) ? filter.value : [filter.value];
          params.append(filter.column, `in.(${values.map(encodeValue).join(',')})`);
        } else if (filter.type === 'not') {
          params.append(filter.column, `not.${filter.operator}.${encodeValue(filter.value)}`);
        }
      });

      // OR conditions (Supabase-style raw expression)
      if (queryState.orConditions.length > 0) {
        params.append('or', queryState.orConditions.join(','));
      }
      
      // Order (chain multiple .order() like PostgREST: col1.asc,col2.desc)
      if (queryState.order.length > 0) {
        params.set(
          'order',
          queryState.order
            .map(
              (o: { column: string; ascending: boolean }) =>
                `${o.column}.${o.ascending ? 'asc' : 'desc'}`
            )
            .join(',')
        );
      }
      
      // Limit and Offset
      if (queryState.limit) {
        params.set('limit', queryState.limit.toString());
      }
      if (queryState.offset) {
        params.set('offset', queryState.offset.toString());
      }
      
      return `/rest/v1/${table}${params.toString() ? `?${params}` : ''}`;
    };

    const executeQuery = async (method: string = 'GET', body?: any) => {
      let url;
      
      // Special handling for profiles PUT requests
      const idFilterIndex = queryState.filters.findIndex((f: any) => f.type === 'eq' && f.column === 'id');
      if (table === 'profiles' && method === 'PUT' && idFilterIndex !== -1) {
        const profileId = queryState.filters[idFilterIndex].value;
        queryState.filters.splice(idFilterIndex, 1); // Remove id from filters
        url = `/rest/v1/${table}/${profileId}`;
        
        // Add remaining filters as query params
        const params = new URLSearchParams();
        queryState.filters.forEach((filter: any) => {
          if (filter.type === 'eq') params.append(filter.column, `eq.${encodeValue(filter.value)}`);
          if (filter.type === 'neq') params.append(filter.column, `neq.${encodeValue(filter.value)}`);
          if (filter.type === 'is') params.append(filter.column, `is.${encodeValue(filter.value)}`);
          if (filter.type === 'in') {
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            params.append(filter.column, `in.(${values.map(encodeValue).join(',')})`);
          }
          if (filter.type === 'not') params.append(filter.column, `not.${filter.operator}.${encodeValue(filter.value)}`);
        });
        if (queryState.orConditions.length > 0) {
          params.append('or', queryState.orConditions.join(','));
        }
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      // boards update by id (Go handler, not PostgREST query string)
      else if (table === 'boards' && method === 'PUT' && idFilterIndex !== -1) {
        const boardId = queryState.filters[idFilterIndex].value;
        queryState.filters.splice(idFilterIndex, 1);
        url = `/rest/v1/boards/${encodeURIComponent(String(boardId))}`;
        const params = new URLSearchParams();
        queryState.filters.forEach((filter: any) => {
          if (filter.type === 'eq') params.append(filter.column, `eq.${encodeValue(filter.value)}`);
          if (filter.type === 'neq') params.append(filter.column, `neq.${encodeValue(filter.value)}`);
          if (filter.type === 'is') params.append(filter.column, `is.${encodeValue(filter.value)}`);
          if (filter.type === 'in') {
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            params.append(filter.column, `in.(${values.map(encodeValue).join(',')})`);
          }
          if (filter.type === 'not') params.append(filter.column, `not.${filter.operator}.${encodeValue(filter.value)}`);
        });
        if (queryState.orConditions.length > 0) {
          params.append('or', queryState.orConditions.join(','));
        }
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      else if (table === 'threads' && method === 'PUT' && idFilterIndex !== -1) {
        const threadId = queryState.filters[idFilterIndex].value;
        queryState.filters.splice(idFilterIndex, 1);
        url = `/rest/v1/threads/${encodeURIComponent(String(threadId))}`;
        const params = new URLSearchParams();
        queryState.filters.forEach((filter: any) => {
          if (filter.type === 'eq') params.append(filter.column, `eq.${encodeValue(filter.value)}`);
          if (filter.type === 'neq') params.append(filter.column, `neq.${encodeValue(filter.value)}`);
          if (filter.type === 'is') params.append(filter.column, `is.${encodeValue(filter.value)}`);
          if (filter.type === 'in') {
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            params.append(filter.column, `in.(${values.map(encodeValue).join(',')})`);
          }
          if (filter.type === 'not') params.append(filter.column, `not.${filter.operator}.${encodeValue(filter.value)}`);
        });
        if (queryState.orConditions.length > 0) {
          params.append('or', queryState.orConditions.join(','));
        }
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      else if (table === 'posts' && method === 'PUT' && idFilterIndex !== -1) {
        const postId = queryState.filters[idFilterIndex].value;
        queryState.filters.splice(idFilterIndex, 1);
        url = `/rest/v1/posts/${encodeURIComponent(String(postId))}`;
        const params = new URLSearchParams();
        queryState.filters.forEach((filter: any) => {
          if (filter.type === 'eq') params.append(filter.column, `eq.${encodeValue(filter.value)}`);
          if (filter.type === 'neq') params.append(filter.column, `neq.${encodeValue(filter.value)}`);
          if (filter.type === 'is') params.append(filter.column, `is.${encodeValue(filter.value)}`);
          if (filter.type === 'in') {
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            params.append(filter.column, `in.(${values.map(encodeValue).join(',')})`);
          }
          if (filter.type === 'not') params.append(filter.column, `not.${filter.operator}.${encodeValue(filter.value)}`);
        });
        if (queryState.orConditions.length > 0) {
          params.append('or', queryState.orConditions.join(','));
        }
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      // Special handling for posts INSERT requests
      else if (table === 'posts' && method === 'POST') {
        url = `/rest/v1/posts`;
        // Add select as query param if present
        const params = new URLSearchParams();
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      // Special handling for threads INSERT requests
      else if (table === 'threads' && method === 'POST') {
        url = `/rest/v1/threads`;
        // Add select as query param if present
        const params = new URLSearchParams();
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      // Special handling for boards INSERT requests
      else if (table === 'boards' && method === 'POST') {
        url = `/rest/v1/boards`;
        // Add select as query param if present
        const params = new URLSearchParams();
        if (queryState.select !== '*') {
          params.set('select', queryState.select);
        }
        url += params.toString() ? `?${params}` : '';
      }
      else if (table === 'thread_likes' && method === 'POST' && body?.thread_id) {
        url = `/rest/v1/threads/${encodeURIComponent(String(body.thread_id))}/like`;
      }
      else if (table === 'post_likes' && method === 'POST' && body?.post_id) {
        url = `/rest/v1/posts/${encodeURIComponent(String(body.post_id))}/like`;
      }
      else if (table === 'thread_likes' && method === 'DELETE') {
        const tidEq = queryState.filters.find((f: any) => f.type === 'eq' && f.column === 'thread_id');
        if (tidEq?.value != null && tidEq.value !== '') {
          url = `/rest/v1/threads/${encodeURIComponent(String(tidEq.value))}/like`;
        } else {
          url = buildQuery();
        }
      }
      else if (table === 'post_likes' && method === 'DELETE') {
        const pidEq = queryState.filters.find((f: any) => f.type === 'eq' && f.column === 'post_id');
        if (pidEq?.value != null && pidEq.value !== '') {
          url = `/rest/v1/posts/${encodeURIComponent(String(pidEq.value))}/like`;
        } else {
          url = buildQuery();
        }
      }
      else {
        url = buildQuery();
      }
      
      const options: RequestInit = { method };
      
      if (body && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(body);
        options.headers = { 'Content-Type': 'application/json' };
      }
      
      const response = await apiClient.rawRequest(url, options);
      if (queryState.selectOptions?.count === 'exact') {
        const list = Array.isArray(response.data) ? response.data : (response.data ? [response.data] : []);
        const count = list.length;
        if (queryState.selectOptions.head) {
          return { ...response, data: null, count };
        }
        return { ...response, count };
      }
      return response;
    };

    const createMutationBuilder = (method: 'PUT' | 'DELETE', data?: any) => {
      const builder: any = {
        eq: (column: string, value: any) => {
          queryState.filters.push({ type: 'eq', column, value });
          return builder;
        },
        in: (column: string, values: any[]) => {
          queryState.filters.push({ type: 'in', column, value: values });
          return builder;
        },
        neq: (column: string, value: any) => {
          queryState.filters.push({ type: 'neq', column, value });
          return builder;
        },
        is: (column: string, value: any) => {
          queryState.filters.push({ type: 'is', column, value });
          return builder;
        },
        not: (column: string, operator: string, value: any) => {
          queryState.filters.push({ type: 'not', column, operator, value });
          return builder;
        },
        or: (conditions: string) => {
          queryState.orConditions.push(conditions);
          return builder;
        },
        select: (columns: string = '*') => {
          queryState.select = columns;
          return builder;
        },
        single: () => executeQuery(method, data).then(result => {
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            return { ...result, data: result.data[0] };
          }
          return result;
        }),
        maybeSingle: () => executeQuery(method, data).then(result => {
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            return { ...result, data: result.data[0] };
          }
          return { ...result, data: null };
        }),
        then: (callback: any) => executeQuery(method, data).then(callback),
      };
      return builder;
    };

    const createInsertBuilder = (data: any) => {
      const builder: any = {
        select: (columns: string = '*') => {
          queryState.select = columns;
          return builder;
        },
        single: () => executeQuery('POST', data).then(result => {
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            return { ...result, data: result.data[0] };
          }
          return result;
        }),
        maybeSingle: () => executeQuery('POST', data).then(result => {
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            return { ...result, data: result.data[0] };
          }
          return { ...result, data: null };
        }),
        then: (callback: any) => executeQuery('POST', data).then(callback),
      };
      return builder;
    };

    const base: any = {
      select: (columns: string = '*', options?: { count?: string; head?: boolean }) => {
        queryState.select = columns;
        queryState.selectOptions = options ?? null;
        return createQueryBuilder();
      },
      
      insert: (data: any) => {
        queryState.select = '*';
        return createInsertBuilder(data);
      },
      
      update: (data: any) => {
        return createMutationBuilder('PUT', data);
      },
      
      delete: () => {
        return createMutationBuilder('DELETE');
      },
      
      upsert: (data: any) => createInsertBuilder(data),
    };

    return base;

    function createQueryBuilder() {
      const builder: any = {
        eq: (column: string, value: any) => {
          queryState.filters.push({ type: 'eq', column, value });
          return builder;
        },
        
        in: (column: string, values: any[]) => {
          queryState.filters.push({ type: 'in', column, value: values });
          return builder;
        },
        
        neq: (column: string, value: any) => {
          queryState.filters.push({ type: 'neq', column, value });
          return builder;
        },
        
        is: (column: string, value: any) => {
          queryState.filters.push({ type: 'is', column, value });
          return builder;
        },

        not: (column: string, operator: string, value: any) => {
          queryState.filters.push({ type: 'not', column, operator, value });
          return builder;
        },

        or: (conditions: string) => {
          queryState.orConditions.push(conditions);
          return builder;
        },
        
        order: (column: string, options?: { ascending?: boolean }) => {
          queryState.order.push({ column, ascending: options?.ascending ?? true });
          return builder;
        },
        
        limit: (count: number) => {
          queryState.limit = count;
          return builder;
        },
        
        range: (from: number, to?: number) => {
          queryState.offset = from;
          if (to !== undefined) {
            queryState.limit = Math.max(0, to - from + 1);
          }
          return builder;
        },
        
        single: () => executeQuery().then(result => {
          // PostgREST: exactly one row; empty → null (not [])
          if (result.data && Array.isArray(result.data)) {
            if (result.data.length === 1) {
              return { ...result, data: result.data[0] };
            }
            return { ...result, data: null };
          }
          return result;
        }),
        maybeSingle: () => executeQuery().then(result => {
          // Handle maybe single result extraction
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            return { ...result, data: result.data[0] };
          }
          return { ...result, data: null };
        }),
        then: (callback: any) => executeQuery().then(callback)
      };
      return builder;
    }
  },

  // RPC
  rpc: (functionName: string, params?: any) => {
    return {
      then: (callback: any) => {
        switch (functionName) {
          case 'get_post_likes_count':
            return apiClient.getPostLikesCount(params?.post_uuid).then(callback);
          case 'get_thread_likes_count':
            return apiClient.getThreadLikesCount(params?.thread_uuid).then(callback);
          case 'has_user_liked_post':
            return apiClient.hasUserLikedPost(params?.post_uuid, params?.user_uuid).then(callback);
          case 'has_user_liked_thread':
            return apiClient.hasUserLikedThread(params?.thread_uuid, params?.user_uuid).then(callback);
          case 'get_recent_post_likers':
            return apiClient.getRecentPostLikers(params?.post_uuid, params?.limit_count).then(callback);
          case 'get_recent_thread_likers':
            return apiClient.getRecentThreadLikers(params?.thread_uuid, params?.limit_count).then(callback);
          case 'get_user_likes_received_count':
            return apiClient.getUserLikesReceivedCount(params?.user_uuid).then(callback);
          case 'get_user_thread_likes_received_count':
            return apiClient.getUserThreadLikesReceivedCount(params?.user_uuid).then(callback);
          case 'get_user_post_likes_received_timestamps':
            return apiClient.getUserPostLikesReceivedTimestamps(params?.user_uuid).then(callback);
          case 'get_user_thread_likes_received_timestamps':
            return apiClient.getUserThreadLikesReceivedTimestamps(params?.user_uuid).then(callback);
          case 'get_user_thread_reply_timestamps':
            return apiClient.getUserThreadReplyTimestamps(params?.user_uuid).then(callback);
          default:
            return Promise.resolve({ data: null, error: 'Unknown RPC function' });
        }
      }
    };
  },

  // Storage
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: File) => {
        const safeBucket = bucket;
        const safeKey = path.replace(/^\/+/, "");
        const presignRes = await fetch(`${API_BASE_URL}/storage/v1/presign-upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": API_KEY,
          },
          body: JSON.stringify({
            bucket: safeBucket,
            key: safeKey,
            content_type: file.type || "application/octet-stream",
            expires_seconds: 3600,
          }),
        });

        if (!presignRes.ok) {
          return { data: null, error: { message: `Presign failed: ${presignRes.status}` } };
        }

        const presign = await presignRes.json();
        if (!presign?.success || !presign?.upload_url) {
          return { data: null, error: { message: presign?.error || "Presign failed" } };
        }

        const putRes = await fetch(presign.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });

        if (!putRes.ok) {
          return { data: null, error: { message: `PUT failed: ${putRes.status}` } };
        }

        return { data: { path: safeKey }, error: null };
      },
      getPublicUrl: (path: string) => {
        const safePath = path.replace(/^\/+/, "");
        const encodedKey = safePath
          .split("/")
          .map((seg) => encodeURIComponent(seg))
          .join("/");
        return {
          data: {
            publicUrl: `${API_BASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`,
          },
        };
      }
    })
  }
};

export default supabase;
