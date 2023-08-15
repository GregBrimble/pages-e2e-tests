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

	wranglerProcess.stdout.on("readable", () => {
		let chunk: any;
		while (null !== (chunk = wranglerProcess.stdout.read())) {
			logger.debug(chunk.toString());
		}
	});

	wranglerProcess.stderr.on("readable", () => {
		let chunk: any;
		while (null !== (chunk = wranglerProcess.stderr.read())) {
			const chunkStr = chunk.toString();

			logger.debug(chunkStr);

			if (chunkStr.includes("The Workers runtime failed to start")) {
				logger.error(
					"Error: Wrangler failed to start the dev server, aborting!"
				);
				wranglerProcess.kill();
			}
		}
	});

	return promise;
};
