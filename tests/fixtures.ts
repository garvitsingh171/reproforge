export function har(
  overrides: {
    status?: number;
    method?: string;
    url?: string;
    body?: string;
    mime?: string;
    size?: number;
    resource?: string;
  } = {},
) {
  return {
    startedDateTime: '2026-10-29T09:00:00.000Z',
    time: 42,
    _resourceType: overrides.resource ?? 'fetch',
    request: {
      method: overrides.method ?? 'POST',
      url:
        overrides.url ??
        'https://production.example/api/investments?token=secret-query',
      headers: [
        { name: 'Authorization', value: 'Bearer secret-auth' },
        { name: 'Cookie', value: 'session=secret-cookie' },
        { name: 'content-type', value: 'application/json' },
      ],
      postData: {
        mimeType: overrides.mime ?? 'application/json',
        text:
          overrides.body ??
          JSON.stringify({
            symbol: 'DEMO',
            amount: 100,
            currency: 'USD',
            type: 'monthly',
          }),
      },
    },
    response: {
      status: overrides.status ?? 422,
      statusText: 'Unprocessable Entity',
      content: {
        mimeType: overrides.mime ?? 'application/json',
        size: overrides.size ?? 100,
      },
    },
    getContent: (callback: (text: string, encoding: string) => void) =>
      callback('{"code":"INVALID_INTERVAL","token":"secret-response"}', ''),
  } as unknown as chrome.devtools.network.Request;
}
