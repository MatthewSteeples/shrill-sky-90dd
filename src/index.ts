/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

type WorkerEnv = {
	UPSTREAM_BASE_URL: string;
	LOGS_BUCKET: R2Bucket;
};

function joinPath(basePathname: string, requestPathname: string): string {
	const base = basePathname.endsWith('/') ? basePathname.slice(0, -1) : basePathname;
	const path = requestPathname.startsWith('/') ? requestPathname : `/${requestPathname}`;
	return `${base}${path}`;
}

function headersToText(headers: Headers): string {
	const lines: string[] = [];
	for (const [key, value] of headers.entries()) {
		lines.push(`${key}: ${value}`);
	}
	return `${lines.join('\n')}\n`;
}

async function sha256Base64Url(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	let binary = '';
	for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
	const b64 = btoa(binary);
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function bodyToText(body: ArrayBuffer | null): Promise<string> {
	if (!body || body.byteLength === 0) return '';
	return new TextDecoder().decode(body);
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

async function computeLogPrefix(requestUrl: string, ticks: number): Promise<string> {
	const url = new URL(requestUrl);
	const readable = buildReadablePrefixFromPathname(url.pathname, 160);
	const urlHash = (await sha256Base64Url(requestUrl)).slice(0, 16);
	return `${readable}/${ticks}_${urlHash}`;
}

async function writeProxyLogs(params: {
	bucket: R2Bucket;
	prefix: string;
	request: Request;
	response: Response;
}): Promise<void> {
	const { bucket, prefix, request, response } = params;

	const reqHeadersText = [
		`${request.method} ${request.url}`,
		headersToText(request.headers).trimEnd(),
		'',
	].join('\n');

	const reqBodyBytes = await request.arrayBuffer().catch(() => null);
	const reqBodyText = await bodyToText(reqBodyBytes);

	const respHeadersText = [
		`${response.status} ${response.statusText}`.trimEnd(),
		headersToText(response.headers).trimEnd(),
		'',
	].join('\n');

	const respBodyBytes = await response.arrayBuffer().catch(() => null);
	const respBodyText = await bodyToText(respBodyBytes);

	await Promise.all([
		bucket.put(`${prefix}/request-headers.txt`, reqHeadersText, {
			httpMetadata: { contentType: 'text/plain; charset=utf-8' },
		}),
		bucket.put(`${prefix}/request-body.txt`, reqBodyText, {
			httpMetadata: { contentType: 'text/plain; charset=utf-8' },
		}),
		bucket.put(`${prefix}/response-headers.txt`, respHeadersText, {
			httpMetadata: { contentType: 'text/plain; charset=utf-8' },
		}),
		bucket.put(`${prefix}/response-body.txt`, respBodyText, {
			httpMetadata: { contentType: 'text/plain; charset=utf-8' },
		}),
	]);
}

export default {
	async fetch(request, env: WorkerEnv, ctx): Promise<Response> {
		const upstreamBase = env.UPSTREAM_BASE_URL;
		if (!upstreamBase) {
			return new Response('Missing required config: UPSTREAM_BASE_URL', { status: 500 });
		}
		if (!env.LOGS_BUCKET) {
			return new Response('Missing required binding: LOGS_BUCKET', { status: 500 });
		}

		const baseUrl = new URL(upstreamBase);
		const incomingUrl = new URL(request.url);
		const upstreamUrl = new URL(request.url);
		upstreamUrl.protocol = baseUrl.protocol;
		upstreamUrl.username = baseUrl.username;
		upstreamUrl.password = baseUrl.password;
		upstreamUrl.host = baseUrl.host;
		upstreamUrl.pathname = joinPath(baseUrl.pathname || '/', incomingUrl.pathname);

		const ticks = Date.now();
		const logPrefixPromise = computeLogPrefix(request.url, ticks);

		const requestForUpstream = request.clone();
		const requestForLog = request.clone();
		const upstreamRequest = new Request(upstreamUrl.toString(), requestForUpstream);

		const upstreamResponse = await fetch(upstreamRequest);
		const responseForLog = upstreamResponse.clone();

		ctx.waitUntil(
			(async () => {
				const prefix = await logPrefixPromise;
				await writeProxyLogs({
					bucket: env.LOGS_BUCKET,
					prefix,
					request: requestForLog,
					response: responseForLog,
				});
			})(),
		);

		return upstreamResponse;
	},
} satisfies ExportedHandler<WorkerEnv>;
