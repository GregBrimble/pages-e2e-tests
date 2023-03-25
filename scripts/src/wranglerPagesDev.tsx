import { fork } from "child_process";
import { join } from "path";
import { DIRNAME } from "./config";
import { Logger } from "./logger";
import { TeardownService } from "./teardownService";

export const wranglerPagesDev = async ({
	logger,
	teardownService,
	rootDirectory,
	buildOutputDirectory,
	arguments: args = [],
}: {
	logger: Logger;
	teardownService: TeardownService;
	rootDirectory: string;
	buildOutputDirectory: string;
	arguments?: string[];
}) => {
	let resolveURL: (url: string) => void;
	const promise = new Promise<string>((resolve) => {
		resolveURL = resolve;
	});

	const wranglerProcess = fork(
		join(DIRNAME, "node_modules/.bin/wrangler"),
		["pages", "dev", buildOutputDirectory, "--port=0", ...args],
		{
			stdio: ["pipe", "pipe", "pipe", "ipc"],
			cwd: rootDirectory,
		}
	).on("message", (message) => {
		const parsedMessage = JSON.parse(message.toString());
		resolveURL(`http://${parsedMessage.ip}:${parsedMessage.port}`);
	});

	teardownService.register({
		name: `'wrangler pages dev' running in ${rootDirectory}`,
		function: () => {
			wranglerProcess.kill("SIGTERM");
		},
	});

	wranglerProcess.stdout?.on("data", (chunk) => {
		logger.debug(chunk);
	});

	wranglerProcess.stderr?.on("data", (chunk) => {
		logger.debug(chunk);
	});

	return promise;
};
