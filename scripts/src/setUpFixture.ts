import { cp, mkdir, readFile } from "fs/promises";
import { globby } from "globby";
import { join, relative } from "path";
import shellac from "shellac";
import stripJsonComments from "strip-json-comments";
import { FIXTURES_PATH, WORKSPACES_PATH } from "./config";
import { Logger } from "./logger";
import { fixturesSchema } from "./schemas";

export const setUpFixture = async ({
	logger,
	fixture,
	timestamp,
}: {
	timestamp: number;
	logger: Logger;
	fixture: string;
}) => {
	const directory = join(WORKSPACES_PATH, `${fixture}-${timestamp}`);
	const fixtureDirectory = join(FIXTURES_PATH, fixture);

	logger.info(`Making workspace directory ${directory}...`);
	await mkdir(directory, { recursive: true });
	logger.info(`Done.`);

	logger.log(`Copying fixture from ${fixtureDirectory} to ${directory}...`);
	const filesToCopy = await globby(join(fixtureDirectory, "**"), {
		gitignore: true,
		dot: true,
	});
	const promisesToCopy = filesToCopy.map((file) =>
		cp(file, join(directory, relative(join(FIXTURES_PATH, fixture), file)), {
			recursive: true,
		})
	);
	await Promise.all(promisesToCopy);
	logger.info(`Done.`);

	logger.log("Reading fixture config...");
	const config = fixturesSchema.parse(
		JSON.parse(
			stripJsonComments(
				await readFile(join(directory, "main.fixture"), "utf-8")
			)
		)
	);
	logger.info("Done.");

	logger.log("Configuring fixture...");
	if (config.setup) {
		await shellac.in(directory)`
			$ export NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}
			$ ${config.setup}
			stdout >> ${logger.info}
		`;
	} else {
		logger.info("No setup command found. Continuing...");
	}
	logger.info("Done.");

	const rootDirectory = join(directory, config.buildConfig.rootDirectory);

	if (config.localSetup) {
		logger.log(`Running local setup command: \`${config.localSetup}\`...`);
		await shellac.in(rootDirectory)`
			$ export NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}
			$ ${config.localSetup}
			stdout >> ${logger.info}
		`;
	}

	return { config, directory };
};
