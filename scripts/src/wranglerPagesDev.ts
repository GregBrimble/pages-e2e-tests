import { fork } from "child_process";
import { fileURLToPath } from "url";
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
		fileURLToPath(
			new URL("../bin/wrangler.js", await import.meta.resolve("wrangler"))
		),
		["pages", "dev", buildOutputDirectory, "--port=0", ...args],
		{
			stdio: ["pipe", "pipe", "pipe", "ipc"],
			cwd: rootDirectory,
			execArgv: [],
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
		logger.debug(chunk.toString());
	});

	wranglerProcess.stderr?.on("data", (chunk) => {
		logger.debug(chunk.toString());
	});

	return promise;
};
