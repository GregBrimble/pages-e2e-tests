import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { argumentParser } from "zodcli";
import { Environment, FIXTURES_PATH, Trigger } from "./src/config";
import { createDeployment } from "./src/createDeployment";
import { installWranglerVersion } from "./src/installWranglerVersion";
import { LogLevel, Logger } from "./src/logger";
import { runTests } from "./src/runTests";
import { Feature, setUpFeatures } from "./src/setUpFeatures";
import { setUpFixture } from "./src/setUpFixture";
import { TeardownService } from "./src/teardownService";
import { uploadTestResults } from "./src/uploadTestResults";

const TRIGGER = Trigger.GitHub;

let teardownService: TeardownService | undefined = undefined;

let success = true;

const main = async () => {
	const startTimestamp = Date.now();

	const {
		logLevel,
		logTimestamp,
		fixturesInclude,
		fixturesExclude,
		environment,
		trigger,
		wranglerVersion,
	} = argumentParser({
		options: z
			.object({
				logLevel: z
					.union([
						z.literal("debug").transform(() => LogLevel.debug),
						z.literal("info").transform(() => LogLevel.info),
						z.literal("log").transform(() => LogLevel.log),
						z.literal("warn").transform(() => LogLevel.warn),
						z.literal("error").transform(() => LogLevel.error),
					])
					.default("log"),
				logTimestamp: z
					.union([
						z.literal("true").transform(() => true),
						z.literal("false").transform(() => false),
						z.null().transform(() => true),
					])
					.default("false"),
				fixturesInclude: z
					.array(
						z
							.string()
							.refine((value) => value.match(/^(?:\w+(?:[-.]\w+)*|\*)$/))
							.refine(
								(value) =>
									value === "*" || existsSync(join(FIXTURES_PATH, value))
							)
					)
					.default(["*"]),
				fixturesExclude: z
					.array(
						z
							.string()
							.refine((value) => value.match(/^(?:[.\w]+(?:-[.\w]+)*|\*)$/))
							.refine((value) => existsSync(join(FIXTURES_PATH, value)))
					)
					.default([]),
				environment: z
					.union([
						z.literal("production").transform(() => Environment.Production),
						z.literal("staging").transform(() => Environment.Staging),
						z.literal("local").transform(() => Environment.Local),
					])
					.default("production"),
				trigger: z
					.union([
						z.literal("GitHub").transform(() => Trigger.GitHub),
						z.literal("GitLab").transform(() => Trigger.GitLab),
						z.literal("DirectUpload").transform(() => Trigger.DirectUpload),
					])
					.default("GitHub"),
				wranglerVersion: z.string().default("beta"),
			})
			.strict(),
	}).parse(process.argv.slice(2));

	const logger = new Logger({ level: logLevel, timestamp: logTimestamp });
	teardownService = new TeardownService({ logger });

	const fixtures = (await readdir(FIXTURES_PATH, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.map(({ name }) => name)
		.filter((name) => {
			if (fixturesInclude.includes("*") && !fixturesExclude.includes(name)) {
				return true;
			}

			return fixturesInclude.includes(name) && !fixturesExclude.includes(name);
		});

	logger.log(
		`Welcome to the Pages e2e test runner!
We're starting at ${startTimestamp}, and we're going to run the following fixtures: ${fixtures.join(
			", "
		)}.
This is going to be evaluated on ${environment}, using ${TRIGGER} as the trigger.`
	);

	await installWranglerVersion({
		logger,
		teardownService,
		version: wranglerVersion,
	});

	const deployedFixtures = Object.fromEntries(
		await Promise.all(
			fixtures.map(async (fixture) => {
				const fixtureLogger = Logger.from({
					logger,
					label: `[${fixture}]`,
				});
				const { directory, config: fixtureConfig } = await setUpFixture({
					logger: fixtureLogger,
					fixture,
				});
				const { config: featuresConfig } = await setUpFeatures({
					logger: fixtureLogger,
					features: fixtureConfig.features,
					directory,
				});
				const { url } = await createDeployment({
					timestamp: startTimestamp,
					environment,
					trigger,
					logger: fixtureLogger,
					teardownService,
					fixture,
					fixtureConfig,
					featuresConfig,
					directory,
				});
				return [fixture, { url, features: fixtureConfig.features }];
			}) as Promise<[string, { url: string; features: Feature[] }]>[]
		)
	);

	const testResults = await runTests({
		logger,
		fixtures: deployedFixtures,
	});
	success = testResults.success;

	await uploadTestResults({
		logger,
		gitCommitMessage: `${fixtures} @ ${startTimestamp}`,
	});
};

main().finally(() => {
	teardownService?.teardown().then(() => {
		if (!success) {
			process.exitCode = 1;
		}
	});
});
