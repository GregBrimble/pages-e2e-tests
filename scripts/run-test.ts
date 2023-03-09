import { readdir } from "fs/promises";
import { Environment, FIXTURES_PATH, Trigger } from "./src/config";
import { createDeployment } from "./src/createDeployment";
import { Logger, LogLevel } from "./src/logger";
import { runTests } from "./src/runTests";
import { Feature, setUpFeatures } from "./src/setUpFeatures";
import { setUpFixture } from "./src/setUpFixture";
import { TeardownService } from "./src/teardownService";
import { uploadTestResults } from "./src/uploadTestResults";

const ENVIRONMENT = Environment.Production;
const TRIGGER = Trigger.GitHub;

const logger = new Logger({ level: LogLevel.log });
const teardownService = new TeardownService({ logger });

const main = async () => {
	const startTimestamp = Date.now();

	const fixtures = (await readdir(FIXTURES_PATH, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.map(({ name }) => name);

	logger.log(
		`Welcome to the Pages e2e test runner!
We're starting at ${startTimestamp}, and we're going to run the following fixtures: ${fixtures.join(
			", "
		)}.
This is going to be evaluated on ${ENVIRONMENT}, using ${TRIGGER} as the trigger.`
	);

	const deployedFixtures = Object.fromEntries(
		await Promise.all(
			fixtures.map(async (fixture) => {
				const fixtureLogger = Logger.from({
					logger,
					label: `[${fixture}]`,
				});
				const { directory } = await setUpFixture({
					logger: fixtureLogger,
					fixture,
				});
				const { features } = await setUpFeatures({
					logger: fixtureLogger,
					directory,
				});
				const { url } = await createDeployment({
					timestamp: startTimestamp,
					environment: ENVIRONMENT,
					trigger: TRIGGER,
					logger: fixtureLogger,
					teardownService,
					fixture,
					directory,
				});
				return [fixture, { url, features }];
			}) as Promise<[string, { url: string; features: Feature[] }]>[]
		)
	);

	await runTests({
		logger,
		fixtures: deployedFixtures,
	});

	await uploadTestResults({
		logger,
		gitCommitMessage: `${fixtures} @ ${startTimestamp}`,
	});
};

main().finally(() => teardownService.teardown());
