type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
	const wanted = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
	return ORDER[wanted] ?? ORDER.info;
}

function write(level: Level, scope: string, message: string, data?: Record<string, unknown>) {
	if (ORDER[level] < threshold()) return;
	const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
	const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	if (data && Object.keys(data).length) sink(line, data);
	else sink(line);
}

/** A logger tagged with `scope`, filtered by the `LOG_LEVEL` env var (default `info`). */
export function logger(scope: string) {
	return {
		debug: (message: string, data?: Record<string, unknown>) => write('debug', scope, message, data),
		info: (message: string, data?: Record<string, unknown>) => write('info', scope, message, data),
		warn: (message: string, data?: Record<string, unknown>) => write('warn', scope, message, data),
		error: (message: string, data?: Record<string, unknown>) => write('error', scope, message, data)
	};
}

const fetchLog = logger('fetch');

/** `fetch` that logs each outbound request with its status, duration and size, or its failure. */
export async function loggedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
	const url = String(input);
	const method = init?.method ?? 'GET';
	const started = performance.now();
	fetchLog.debug(`→ ${method} ${url}`);
	try {
		const response = await fetch(input, init);
		const ms = Math.round(performance.now() - started);
		const size = response.headers.get('content-length');
		const summary = `← ${response.status} ${method} ${url} ${ms}ms${size ? ` ${size}b` : ''}`;
		if (response.ok) fetchLog.info(summary);
		else fetchLog.warn(summary);
		return response;
	} catch (caught) {
		const ms = Math.round(performance.now() - started);
		const reason =
			caught instanceof Error && caught.name === 'TimeoutError'
				? 'timed out'
				: caught instanceof Error
					? caught.message
					: String(caught);
		fetchLog.error(`✗ ${method} ${url} ${ms}ms ${reason}`);
		throw caught;
	}
}
