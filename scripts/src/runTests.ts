import { build, BuildOptions } from "esbuild";
import { mkdir, rm } from "fs/promises";
import { globby } from "globby";
import { join } from "path";
import GitHubActionsReporter from "vitest-github-actions-reporter";
import { startVitest } from "vitest/node";
import {
	FEATURES_PATH,
	FIXTURES_PATH,
	GLOBAL_TESTS_PATH,
	TEST_EXCLUDE,
	TEST_INCLUDE,
	TEST_RESULTS_PATH,
	TESTS_PATH,
} from "./config";
import { Logger } from "./logger";
import { Feature } from "./setUpFeatures";

export const runTests = async ({
	logger,
	fixtures,
}: {
	logger: Logger;
	fixtures: {
		[fixture: string]: { url: string; features: Feature[] };
	};
}) => {
	logger.debug("Preparing tests...");
	const testBuildOptions: BuildOptions = {
		bundle: true,
		platform: "node",
		format: "esm",
		external: ["vitest"],
		outExtension: { ".js": ".ts" },
		sourcemap: true,
	};
	await rm(TESTS_PATH, { force: true, recursive: true });
	await Promise.all(
		Object.entries(fixtures)
			.map(([fixture, { url, features }]) => [
				globby(
					features
						.map(({ path }) =>
							TEST_INCLUDE.map((include) => join(path, include))
						)
						.flat(1),
					{ ignore: TEST_EXCLUDE, gitignore: true }
				).then((entryPoints) =>
					build({
						...testBuildOptions,
						entryPoints,
						outdir: join(TESTS_PATH, fixture, "features"),
						outbase: join(FEATURES_PATH),
						define: {
							DEPLOYMENT_URL: JSON.stringify(url),
						},
					})
				),
				globby(
					TEST_INCLUDE.map((include) => join(GLOBAL_TESTS_PATH, include)),
					{ ignore: TEST_EXCLUDE, gitignore: true }
				).then((entryPoints) =>
					build({
						...testBuildOptions,
						entryPoints,
						outdir: join(TESTS_PATH, fixture, "__tests__"),
						outbase: join(GLOBAL_TESTS_PATH),
						define: {
							DEPLOYMENT_URL: JSON.stringify(url),
						},
					})
				),
				globby(
					TEST_INCLUDE.map((include) => join(FIXTURES_PATH, fixture, include)),
					{ ignore: TEST_EXCLUDE, gitignore: true }
				).then((entryPoints) =>
					build({
						...testBuildOptions,
						entryPoints,
						outdir: join(TESTS_PATH, fixture),
						outbase: join(FIXTURES_PATH, fixture),
						define: {
							DEPLOYMENT_URL: JSON.stringify(url),
						},
					})
				),
			])
			.flat(1)
	);
	logger.debug("Done.");

	logger.log("Running tests...");
	await rm(TEST_RESULTS_PATH, { recursive: true, force: true });
	const oldCwd = process.cwd();
	await mkdir(TESTS_PATH, { recursive: true });
	process.chdir(TESTS_PATH);
	const vitest = await startVitest("test", [], {
		run: true,
		include: TEST_INCLUDE,
		exclude: TEST_EXCLUDE,
		reporters: [
			"basic",
			"html",
			...[
				process.env.GITHUB_ACTIONS ? new GitHubActionsReporter() : undefined,
			].filter(Boolean),
		],
		outputFile: {
			html: join(TEST_RESULTS_PATH, "index.html"),
		},
		environment: "cfpreview-playwright",
	});
	await vitest.close();
	const errors = vitest.state.errorsSet.size > 0;
	process.chdir(oldCwd);
	logger.info("Done.");

	return !errors;
};
