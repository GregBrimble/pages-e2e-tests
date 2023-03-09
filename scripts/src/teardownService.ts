import type { Logger } from "./logger";

type TeardownFunction = { name: string; function: () => Promise<void> | void };

export class TeardownService {
	teardownFunctions: TeardownFunction[] = [];
	logger: Logger;

	constructor({ logger }: { logger: Logger }) {
		this.logger = logger;
	}

	register(teardownFunction: TeardownFunction) {
		this.teardownFunctions.push(teardownFunction);
	}

	async teardown() {
		const results = await Promise.all(
			this.teardownFunctions.map(async (teardownFunction) => {
				try {
					await teardownFunction.function();
					return { name: teardownFunction };
				} catch (error) {
					return { name: teardownFunction, error };
				}
			})
		);
		this.logger.info("Cleanup complete.");
		for (const { name, error } of results.filter((result) => result.error)) {
			this.logger.warn(`Failed to teardown ${name} function: ${error}`);
		}
	}
}
