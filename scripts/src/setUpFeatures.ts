import { execSync } from "child_process";
import { join } from "path";
import shellac from "shellac";
import { FEATURES_PATH } from "./config";
import { Logger } from "./logger";
import { noMakeCommandStderr } from "./utils";

export interface Feature {
	name: string;
	path: string;
}

export async function setUpFeatures({
	logger,
	directory,
}: {
	logger: Logger;
	directory: string;
}) {
	logger.info(`Parsing fixture features...`);
	let features: Feature[] = [];
	const featuresStdio = await shellac.in(directory)`
		$ make features
	`;
	features = featuresStdio.stdout
		.split(" ")
		.filter(Boolean)
		.map((feature) => ({
			name: feature,
			path: join(FEATURES_PATH, feature),
		}));
	logger.info("Done.", features);

	if (features.length > 0) {
		logger.log(
			`Fixture features detected. Adding ${features
				.map(({ name }) => name)
				.join(", ")}...`
		);
		for (const { name, path } of features) {
			logger.log(`Setting up feature ${name}...`);
			// Can't use shellac for commands which may fail in a particular way :(
			try {
				execSync("make setup", {
					cwd: path,
					encoding: "utf-8",
					env: {
						...process.env,
						WORKSPACE_DIR: directory,
					},
				});
			} catch (thrown) {
				if (thrown.stderr === noMakeCommandStderr("setup")) {
					logger.info("No setup command found. Continuing...");
				} else {
					throw thrown;
				}
			}
			logger.info("Done.");
		}
		logger.info("Done.");
	}

	return { features };
}
