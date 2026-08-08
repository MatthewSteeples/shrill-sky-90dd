import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	const b64 = btoa(binary);
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64UrlEncode(new Uint8Array(digest));
}

function safeKeySegment(value: string): string {
	const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
	return cleaned.length > 0 ? cleaned : 'root';
}

function buildReadablePrefixFromPathname(pathname: string, maxLen = 160): string {
	const segments = pathname.split('/').filter(Boolean).map(safeKeySegment);
	if (segments.length === 0) return 'root';

	let out = '';
	for (const seg of segments) {
		const candidate = out.length === 0 ? seg : `${out}/${seg}`;
		if (candidate.length > maxLen) break;
		out = candidate;
	}

	return out.length > 0 ? out : 'root';
}

describe('Proxy + R2 logging worker', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('returns 500 when ERROR_PERCENTAGE causes a random error', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.1); // 10 < 50 → error triggered

		const fakeBucket = { put: vi.fn() } as unknown as R2Bucket;
		const request = new IncomingRequest('http://incoming.test/api');
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ UPSTREAM_BASE_URL: 'https://example.com', LOGS_BUCKET: fakeBucket, ERROR_PERCENTAGE: 50 } as any,
			ctx,
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
	});

	it('does not return 500 when ERROR_PERCENTAGE is 0', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0); // would trigger if percentage > 0

		const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

		const fakeBucket = { put: vi.fn(async () => ({})) } as unknown as R2Bucket;
		const request = new IncomingRequest('http://incoming.test/api');
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ UPSTREAM_BASE_URL: 'https://example.com', LOGS_BUCKET: fakeBucket, ERROR_PERCENTAGE: 0 } as any,
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
	});

	it('does not return 500 when random value is above ERROR_PERCENTAGE threshold', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.9); // 90 >= 50 → no error

		const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

		const fakeBucket = { put: vi.fn(async () => ({})) } as unknown as R2Bucket;
		const request = new IncomingRequest('http://incoming.test/api');
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ UPSTREAM_BASE_URL: 'https://example.com', LOGS_BUCKET: fakeBucket, ERROR_PERCENTAGE: 50 } as any,
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
	});
		const ticks = 1700000000123;
		vi.stubGlobal('Date', class extends Date {
			static now() {
				return ticks;
			}
		} as unknown as DateConstructor);

		const fetchMock = vi.fn(async (req: Request) => {
			return new Response('upstream-ok', {
				status: 201,
				headers: {
					'x-upstream': 'yes',
					'content-type': 'text/plain; charset=utf-8',
				},
			});
		});
		vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

		const stored = new Map<string, string>();
		const fakeBucket = {
			put: vi.fn(async (key: string, value: unknown) => {
				stored.set(key, String(value ?? ''));
				return { key };
			}),
		} as unknown as R2Bucket;

		const incomingUrl = 'http://incoming.test/api?x=1';
		const request = new IncomingRequest(incomingUrl, {
			method: 'POST',
			headers: {
				'x-req': 'abc',
				'content-type': 'application/json',
			},
			body: JSON.stringify({ hello: 'world' }),
		});

		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{
				UPSTREAM_BASE_URL: 'https://example.com',
				LOGS_BUCKET: fakeBucket,
			} as any,
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(201);
		expect(response.headers.get('x-upstream')).toBe('yes');
		expect(await response.text()).toBe('upstream-ok');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledWith = fetchMock.mock.calls[0]?.[0] as Request;
		expect(calledWith.url).toBe('https://example.com/api?x=1');
		expect(calledWith.method).toBe('POST');
		expect(calledWith.headers.get('x-req')).toBe('abc');

		const url = new URL(incomingUrl);
		const readable = buildReadablePrefixFromPathname(url.pathname, 160);
		const urlHash = (await sha256Base64Url(incomingUrl)).slice(0, 16);
		const prefix = `${readable}/${ticks}_${urlHash}`;

		expect((fakeBucket as any).put).toHaveBeenCalledTimes(4);
		const keys = Array.from(stored.keys()).sort();
		expect(keys).toEqual([
			`${prefix}/request-body.txt`,
			`${prefix}/request-headers.txt`,
			`${prefix}/response-body.txt`,
			`${prefix}/response-headers.txt`,
		]);

		expect(stored.get(`${prefix}/request-headers.txt`)).toContain(`POST ${incomingUrl}`);
		expect(stored.get(`${prefix}/request-headers.txt`)).toContain('x-req: abc');
		expect(stored.get(`${prefix}/request-body.txt`)).toContain('\"hello\":\"world\"');
		expect(stored.get(`${prefix}/response-headers.txt`)).toContain('201');
		expect(stored.get(`${prefix}/response-headers.txt`)).toContain('x-upstream: yes');
		expect(stored.get(`${prefix}/response-body.txt`)).toBe('upstream-ok');
	});
});
