import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../apiConfig';

/**
 * One place for every request the app makes.
 *
 * Before this, fifteen pages each did their own fetch, each kept its own
 * `loading` / `error` state, and each handled a failure differently - usually by
 * rendering nothing at all, which looks identical to "still loading" and leaves
 * the user stuck with no way to retry.
 *
 * useApi fixes that by giving all of them the same behaviour:
 *   - one place that knows how to build a request and unwrap an error message
 *   - a request that is aborted when the component unmounts or the deps change,
 *     so a slow response cannot overwrite a newer one
 *   - loading / error / data states that are always consistent
 *   - a retry function, so a failed load is one click from recovered
 */

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Perform a request and return the parsed body, throwing an ApiError carrying
 * the server's own message when the response is not ok.
 *
 * A 401 is worth special handling: the session has expired, so a message like
 * "try again" is useless. `onUnauthorized` lets the app send the user to log in.
 */
export async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body,
    signal,
    headers: extra,
    onUnauthorized
  } = options;

  const init = {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(extra || {})
    }
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    // A rejected fetch is the network being unreachable. Say so plainly rather
    // than surfacing "Failed to fetch".
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check your connection.', 0, null);
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch (_) { parsed = { raw: text }; }
  }

  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const message = (parsed && (parsed.message || parsed.error))
      || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, parsed);
  }
  return parsed;
}

/**
 * Load something on mount and whenever `deps` change.
 *
 * Returns { data, loading, error, reload, setData }. `reload` is what an
 * ErrorState's retry button calls.
 *
 * `immediate: false` skips the first load, for a search box that should only
 * query once the user stops typing.
 */
export function useApi(path, options = {}) {
  const {
    deps = [],
    immediate = true,
    transform,
    onUnauthorized,
    enabled = true
  } = options;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate && enabled);
  const [error, setError] = useState(null);

  const controllerRef = useRef(null);
  // Kept in a ref so reload() is stable and can be called from a retry button
  // without re-triggering the effect.
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const run = useCallback(async () => {
    if (!enabled || !path) {
      setLoading(false);
      return;
    }
    // Drop the previous request: its response must not land after this one.
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch(path, {
        signal: controller.signal,
        onUnauthorized: onUnauthorizedRef.current
      });
      if (controller.signal.aborted) return;
      const t = transformRef.current;
      setData(t ? t(body) : body);
      setError(null);
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setError(err instanceof ApiError ? err : new ApiError(err.message || 'Something went wrong', 0, null));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    if (!immediate) return undefined;
    run();
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, immediate, ...deps]);

  return {
    data,
    loading,
    error,
    reload: run,
    setData,
    /** True only for the very first load, so a refresh does not blank the page. */
    initialLoading: loading && data === null
  };
}

/**
 * Debounce a rapidly changing value - a search box. Returns the value only
 * after it has been still for `delay` ms.
 */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default useApi;