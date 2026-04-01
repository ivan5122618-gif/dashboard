/**
 * 统一 HTTP 调用封装（你只需要改这里即可接入鉴权、网关、超时等）。
 *
 * - **对应界面**：全页面所有数据请求都会走这里
 * - **你需要填的内容**：
 *   - baseURL（可用 Vite 环境变量）
 *   - headers（如 token）
 *   - error 处理（按你们后端协议）
 */
const DEFAULT_TIMEOUT_MS = 20_000;

function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    promise: (async () => {
      try {
        return await promise(controller.signal);
      } finally {
        clearTimeout(timer);
      }
    })(),
  };
}

export async function fetchJson(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    // 允许你传 query 或者自己拼 url
  } = {},
) {
  const { promise } = withTimeout(
    (signal) =>
      fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal,
      }),
    timeoutMs,
  );

  const res = await promise;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 返回也允许（按需改）
  }

  if (!res.ok) {
    const message =
      (json && (json.message || json.msg)) ||
      `${res.status} ${res.statusText}` ||
      'Request failed';
    const err = new Error(message);
    err.status = res.status;
    err.payload = json ?? text;
    throw err;
  }

  return json;
}

