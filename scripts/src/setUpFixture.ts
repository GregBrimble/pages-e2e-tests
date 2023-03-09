import { execSync } from "child_process";
import { cp, mkdir } from "fs/promises";
import { globby } from "globby";
import { tmpdir } from "os";
import { join, relative } from "path";
import shellac from "shellac";
import { ASSETS_PATH, FIXTURES_PATH } from "./config";
import { Logger } from "./logger";
import { noMakeCommandStderr } from "./utils";

export async function setUpFixture({
	logger,
	fixture,
}: {
	logger: Logger;
	fixture: string;
}) {
	const directory = join(tmpdir(), Math.random().toString(36).slice(2));
	const fixtureDirectory = join(FIXTURES_PATH, fixture);

	logger.info(`Making workspace directory ${directory}...`);
	await mkdir(directory);
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

	logger.log("Setting up the fixture...");
	await shellac.in(directory)`
		$ cat ${join(ASSETS_PATH, "appendage.Makefile")} >> ${join(
		directory,
		"Makefile"
	)}
	`;
	// Can't use shellac for commands which may fail in a particular way :(
	try {
		execSync("make setup", {
			cwd: directory,
			encoding: "utf-8",
		});
	} catch (error) {
		if (error.stderr.trimRight() === noMakeCommandStderr("setup")) {
			logger.info("No setup command found. Continuing...");
		} else {
			throw error;
		}
	}
	logger.info("Done.");

	return { directory };
}
