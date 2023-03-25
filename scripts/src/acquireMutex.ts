import {
	MUTEX_CHECK_INTERVAL,
	MUTEX_CONSIDERED_STALE_TIMEOUT,
	MUTEX_TIMEOUT,
} from "./config";
import { Logger } from "./logger";
import { transformResponseIntoError } from "./utils";

interface Mutex {
	ETag: string;
	key: string;
	id: string;
	timestamp: string;
}

interface MutexResponse {
	id: string;
	timestamp: string;
}

export const acquireMutex = async ({
	logger,
	key,
}: {
	logger: Logger;
	key: string;
}) => {
	let resolvePromise: (mutex: Mutex) => void,
		rejectPromise: (reason?: any) => void;
	const promise = new Promise<Mutex>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});

	const timeout = setTimeout(rejectPromise, MUTEX_TIMEOUT);

	let interval: NodeJS.Timer;

	const attemptToAcquireMutex = async () => {
		const resolve = (mutex: Mutex) => {
			clearTimeout(timeout);
			clearInterval(interval);
			logger.info("Acquired Mutex.", mutex);
			resolvePromise(mutex);
		};

		logger.debug(`Attempting to acquire Mutex \`${key}\`...`);
		const response = await fetch(`https://mutex.uno/api/${key}`, {
			method: "POST",
		});
		switch (response.status) {
			case 201: {
				const mutex: Mutex = {
					ETag: response.headers.get("ETag"),
					key,
					...((await response.json()) as MutexResponse),
				};
				resolve(mutex);
				break;
			}
			case 409: {
				const mutex: Mutex = {
					ETag: response.headers.get("ETag"),
					key,
					...((await response.json()) as MutexResponse),
				};
				logger.info("Mutex already locked.", mutex);
				if (
					Date.now() - new Date(mutex.timestamp).getTime() >=
					MUTEX_CONSIDERED_STALE_TIMEOUT
				) {
					logger.info(
						"Mutex considered stale. Attempting to forcibly acquire..."
					);
					const response = await fetch(`https://mutex.uno/api/${key}`, {
						method: "POST",
						headers: {
							"If-Match": mutex.ETag,
						},
					});
					if (response.ok) {
						const mutex: Mutex = {
							ETag: response.headers.get("ETag"),
							key,
							...((await response.json()) as MutexResponse),
						};
						resolve(mutex);
						break;
					}
				}
				break;
			}
			default: {
				logger.warn(
					await transformResponseIntoError(response, await response.text())
				);
			}
		}
	};

	interval = setInterval(attemptToAcquireMutex, MUTEX_CHECK_INTERVAL);

	return promise;
};
