import { ok } from "assert";
import { execSync } from "child_process";
import * as dotenv from "dotenv";
import { build, BuildOptions } from "esbuild";
import { cp, mkdir, rm } from "fs/promises";
import { globby } from "globby";
import { tmpdir } from "os";
import { join } from "path";
import shellac from "shellac";
import { fileURLToPath } from "url";
import { defaultExclude, defaultInclude } from "vitest/config";
import { startVitest } from "vitest/node";
import { unstable_pages } from "wrangler";
import {
	noMakeCommandStderr,
	ONE_MINUTE,
	ONE_SECOND,
	responseIsNotProvisioned,
	transformResponseIntoError,
} from "./utils";

const DIRNAME = fileURLToPath(new URL("../", import.meta.url));

dotenv.config({ path: join(DIRNAME, ".env") });

const GIT_REPO = "git@github.com:GregBrimble/pages-e2e-tests.git";
const GIT_USERNAME = "Pages e2e Tests Bot";
const GIT_EMAIL_ADDRESS = "cloudflare-pages-team@cloudflare.com";

const CLOUDFLARE_ACCOUNT_ID = "5a883b414d4090a1442b20361f3c43a9";
const { CLOUDFLARE_API_TOKEN } = process.env;
const PAGES_PROJECT_NAME = "pages-e2e-tests-tmp";

const TEST_INCLUDE = defaultInclude;
const TEST_EXCLUDE = defaultExclude;
const TEST_RESULTS_BRANCH_NAME = "test-results";
const TEST_RESULTS_PATH = join(DIRNAME, "dist");

// https://developers.cloudflare.com/pages/platform/limits#builds
// Pages Builds are allowed 20 minutes, and we're adding a buffer of time of 3 minutes to allow for queueing
const DEPLOYMENT_TIMEOUT = 23 * ONE_MINUTE;
// How frequently we should poll the Pages API to check for Deployment completion
const DEPLOYMENT_CHECK_INTERVAL = 5 * ONE_SECOND;
// How many not-OK API responses we accept when polling for Deployment completion before erroring
const DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD = 5;
// How long we wait for the Deployment to actually go live on the internet after Build completion
const PROVISIONER_TIMEOUT = 30 * ONE_SECOND;
// How frequently we should poll the deployment URL to check for provisioner completion
const PROVISIONER_CHECK_INTERVAL = 5 * ONE_SECOND;

const FIXTURE = process.argv[2];
const NOW = Date.now();

const GIT_BRANCH_NAME = `${FIXTURE}-${NOW}`;
const GIT_COMMIT_MESSAGE = `${FIXTURE} @ ${NOW}`;
const DEPLOY_HOOK_NAME = `${FIXTURE}-${NOW}`;

const FIXTURES_PATH = join(DIRNAME, "fixtures");
const FEATURES_PATH = join(DIRNAME, "features");
const FIXTURE_PATH = join(FIXTURES_PATH, FIXTURE);
const WORKSPACE_PATH = join(tmpdir(), Math.random().toString(36).slice(2));
const ASSETS_PATH = join(DIRNAME, "assets");
const GLOBAL_TESTS_PATH = join(DIRNAME, "__tests__");
const TESTS_PATH = join(DIRNAME, "test-workspaces");

interface CreateDeployHookResponse {
	result: {
		hook_id: string;
	};
}

interface DeployHookResponse {
	result: {
		id: string;
	};
}

interface DeploymentResponse {
	result: {
		url: string;
		latest_stage: {
			name: string;
			status: "idle" | "active" | "canceled" | "success" | "failure";
		};
	};
}

const cleanupFunctions: (() => Promise<void> | void)[] = [];

const main = async () => {
	console.log(`Running ${FIXTURE} @ ${NOW}...`);

	console.debug(`Making workspace directory ${WORKSPACE_PATH}...`);
	await mkdir(WORKSPACE_PATH);
	console.debug(`Done.`);

	console.debug(
		`Creating Git repo in ${WORKSPACE_PATH}, adding ${GIT_REPO} remote, and checking out orphan branch ${GIT_BRANCH_NAME}...`
	);
	await shellac.in(WORKSPACE_PATH)`
		$$ git init .
		$$ git remote add origin ${GIT_REPO}
		$$ git checkout --orphan ${GIT_BRANCH_NAME}
  `;
	console.debug(`Done.`);

	console.debug(`Copying fixture from ${FIXTURE_PATH} to ${WORKSPACE_PATH}...`);
	await cp(FIXTURE_PATH, WORKSPACE_PATH, { recursive: true });
	console.debug(`Done.`);

	console.debug("Setting up the fixture...");
	await shellac.in(WORKSPACE_PATH)`
		$ cat ${join(ASSETS_PATH, "appendage.Makefile")} >> ${join(
		WORKSPACE_PATH,
		"Makefile"
	)}
	`;
	// Can't use shellac for commands which may fail in a particular way :(
	try {
		execSync("make setup", {
			cwd: WORKSPACE_PATH,
		});
	} catch (error) {
		if (error.stderr === noMakeCommandStderr("setup")) {
			console.debug("No setup command found. Continuing...");
		} else {
			throw error;
		}
	}
	console.debug("Done.");

	console.debug(`Parsing fixture features...`);
	let features: { name: string; path: string }[] = [];
	const featuresStdio = await shellac.in(WORKSPACE_PATH)`
		$ make features
	`;
	features = featuresStdio.stdout
		.split(" ")
		.filter(Boolean)
		.map((feature) => ({
			name: feature,
			path: join(FEATURES_PATH, feature),
		}));
	console.debug("Done.", features);

	if (features.length > 0) {
		console.debug(
			`Fixture features detected. Adding ${features
				.map(({ name }) => name)
				.join(", ")}...`
		);
		for (const { name, path } of features) {
			console.debug(`Setting up feature ${name}...`);
			// Can't use shellac for commands which may fail in a particular way :(
			try {
				execSync("make setup", {
					cwd: path,
					env: {
						...process.env,
						WORKSPACE_DIR: WORKSPACE_PATH,
					},
				});
			} catch (error) {
				if (error.stderr === noMakeCommandStderr("setup")) {
					console.debug("No setup command found. Continuing...");
				} else {
					throw error;
				}
			}
			console.debug("Done.");
		}
		console.debug("Done.");
	}

	console.debug(
		`Adding files to Git, committing, and pushing to a new branch, ${GIT_BRANCH_NAME}...`
	);
	const { GIT_COMMIT_HASH } = await shellac.in(WORKSPACE_PATH)`
		$$ git add .
		$$ git -c user.name="${GIT_USERNAME}" -c user.email="${GIT_EMAIL_ADDRESS}" commit -m "${GIT_COMMIT_MESSAGE}" --author="${GIT_USERNAME} <${GIT_EMAIL_ADDRESS}> --date=${NOW}"
		$$ git push -f origin ${GIT_BRANCH_NAME}

		$$ git rev-parse HEAD
		stdout >> GIT_COMMIT_HASH
	`;
	console.debug("Done.");
	cleanupFunctions.push(async () => {
		console.debug("Cleaning up Git branch...");
		await shellac.in(WORKSPACE_PATH)`
			$$ git push origin --delete ${GIT_BRANCH_NAME}
		`;
		console.debug("Done.");
	});

	console.debug("Creating Deploy Hook...");
	let deployHookCreationResponse: Response;
	let deployHookCreationResponseText: string;
	let deployHookId: string;
	try {
		deployHookCreationResponse = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT_NAME}/deploy_hooks`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: DEPLOY_HOOK_NAME,
					branch: GIT_BRANCH_NAME,
				}),
			}
		);

		deployHookCreationResponseText = await deployHookCreationResponse.text();

		const {
			result: { hook_id: hookId },
		} = JSON.parse(deployHookCreationResponseText) as CreateDeployHookResponse;

		ok(hookId);
		deployHookId = hookId;
	} catch {
		throw await transformResponseIntoError(
			deployHookCreationResponse,
			deployHookCreationResponseText,
			"Could not create Deploy Hook."
		);
	}
	console.debug("Created Deploy Hook.", deployHookId);
	cleanupFunctions.push(async () => {
		console.debug("Cleaning up Deploy Hook...");
		const deployHookDeletionResponse = await fetch(
			`https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/${deployHookId}`,
			{
				method: "POST",
			}
		);
		ok(deployHookDeletionResponse.ok);
		console.debug("Done.");
	});

	console.debug(`Creating Deployment with Deploy Hook ${deployHookId}...`);
	let deployHookResponse: Response;
	let deployHookResponseText: string;
	let deploymentId: string;
	try {
		deployHookResponse = await fetch(
			`https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/${deployHookId}`,
			{
				method: "POST",
			}
		);

		deployHookResponseText = await deployHookResponse.text();

		const {
			result: { id },
		} = JSON.parse(deployHookResponseText) as DeployHookResponse;

		ok(id);
		deploymentId = id;
	} catch {
		throw await transformResponseIntoError(
			deployHookResponse,
			deployHookResponseText,
			"Could not create Deployment."
		);
	}
	console.debug("Created Deployment.", deploymentId);

	console.debug(`Awaiting Deployment ${deploymentId} completion...`);
	const startDeployment = Date.now();
	let notOkResponses = 0;
	let resolveWithDeploymentSuccess: (url: string) => void;
	let rejectWithDeploymentFailure: (error: Error) => void;

	const deploymentCheckInterval = setInterval(() => {
		if (Date.now() > startDeployment + DEPLOYMENT_TIMEOUT) {
			rejectWithDeploymentFailure(
				new Error(
					`Deployment did not complete within the timeout of ${DEPLOYMENT_TIMEOUT} ms.`
				)
			);
		}

		(async () => {
			// TODO: Stream logs
			let deploymentResponse: Response;
			let deploymentResponseText: string;
			try {
				deploymentResponse = await fetch(
					`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT_NAME}/deployments/${deploymentId}`,
					{
						headers: {
							Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
						},
					}
				);

				deploymentResponseText = await deploymentResponse.text();

				const {
					result: { url, latest_stage: latestStage },
				} = JSON.parse(deploymentResponseText) as DeploymentResponse;

				ok(url);
				ok(latestStage.status);

				if (latestStage.name === "deploy" && latestStage.status === "success") {
					resolveWithDeploymentSuccess(url);
				} else if (
					!["idle", "active", "success"].includes(latestStage.status)
				) {
					rejectWithDeploymentFailure(
						new Error(
							`Deployment ${deploymentId} has failed.\n\nStage: ${latestStage.name}\nStatus: ${latestStage.status}\n\nhttps://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/pages/view/${PAGES_PROJECT_NAME}/${deploymentId}`
						)
					);
				} else {
					console.debug(
						`Deployment is ongoing. Stage: ${latestStage.name}. Status: ${latestStage.status}.`
					);
				}
			} catch {
				notOkResponses++;
				const error = await transformResponseIntoError(
					deploymentResponse,
					deploymentResponseText,
					`Could not parse Deployment API response. Not-OK API response ${notOkResponses} of ${DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD}.`
				);

				if (notOkResponses > DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD) {
					console.debug(
						`Number of not-OK Deployment API responses exceeded allowed threshold ${DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD}. Erroring...`
					);
					throw error;
				} else {
					console.debug(
						`Received a not-OK Deployment API response, ${notOkResponses} of a maximum ${DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD}. Suppressing error...`
					);
					console.debug(error);
				}
			}
		})();
	}, DEPLOYMENT_CHECK_INTERVAL);

	const deploymentURL = await new Promise<string>((resolve, reject) => {
		resolveWithDeploymentSuccess = (...args) => {
			clearInterval(deploymentCheckInterval);
			resolve(...args);
		};
		rejectWithDeploymentFailure = (...args) => {
			clearInterval(deploymentCheckInterval);
			reject(...args);
		};
	});
	console.debug("Deployment complete.", deploymentURL);

	console.debug(`Awaiting ${deploymentURL} to be live at the edge...`);
	const startProvisioner = Date.now();
	let resolveWithProvisionerSuccess: () => void;
	let rejectWithProvisionerFailure: (error: Error) => void;

	const provisionerCheckInterval = setInterval(() => {
		if (Date.now() > startProvisioner + PROVISIONER_TIMEOUT) {
			rejectWithProvisionerFailure(
				new Error(
					`Deployment was not available at the edge within the timeout of ${PROVISIONER_TIMEOUT} ms.`
				)
			);
		}

		(async () => {
			try {
				const response = await fetch(deploymentURL);
				const deploymentIsNotProvisioned = await responseIsNotProvisioned(
					response
				);

				if (deploymentIsNotProvisioned) {
					console.debug("Deployment is not yet available at the edge.");
				} else {
					resolveWithProvisionerSuccess();
				}
			} catch {
				console.debug("Could not check the deployment URL.");
			}
		})();
	}, PROVISIONER_CHECK_INTERVAL);

	await new Promise<void>((resolve, reject) => {
		resolveWithProvisionerSuccess = (...args) => {
			clearInterval(provisionerCheckInterval);
			resolve(...args);
		};
		rejectWithProvisionerFailure = (...args) => {
			clearInterval(provisionerCheckInterval);
			reject(...args);
		};
	});
	console.debug("Deployment available.", deploymentURL);

	console.debug("Preparing tests...");
	const testBuildOptions: BuildOptions = {
		bundle: true,
		platform: "node",
		format: "esm",
		external: ["vitest"],
		sourcemap: true,
		define: {
			DEPLOYMENT_URL: JSON.stringify(deploymentURL),
		},
	};
	await Promise.all([
		build({
			...testBuildOptions,
			entryPoints: await globby(
				features
					.map(({ path }) => TEST_INCLUDE.map((include) => join(path, include)))
					.flat(1),
				{ ignore: TEST_EXCLUDE }
			),
			outdir: join(TESTS_PATH, FIXTURE, "features"),
			outbase: join(FEATURES_PATH),
		}),
		build({
			...testBuildOptions,
			entryPoints: await globby(
				TEST_INCLUDE.map((include) => join(GLOBAL_TESTS_PATH, include)),
				{ ignore: TEST_EXCLUDE }
			),
			outdir: join(TESTS_PATH, FIXTURE, "__tests__"),
			outbase: join(GLOBAL_TESTS_PATH),
		}),
		build({
			...testBuildOptions,
			entryPoints: await globby(
				TEST_INCLUDE.map((include) => join(FIXTURE_PATH, include)),
				{ ignore: TEST_EXCLUDE }
			),
			outdir: join(TESTS_PATH, FIXTURE),
			outbase: join(FIXTURE_PATH),
		}),
	]);
	console.debug("Done.");

	console.debug("Running tests...");
	await rm(TEST_RESULTS_PATH, { recursive: true, force: true });
	process.env.DEPLOYMENT_URL = deploymentURL;
	const oldCwd = process.cwd();
	process.chdir(TESTS_PATH);
	const vitest = await startVitest("test", [], {
		run: true,
		include: TEST_INCLUDE,
		exclude: TEST_EXCLUDE,
		reporters: ["basic", "html"],
		outputFile: {
			html: join(TEST_RESULTS_PATH, "index.html"),
		},
	});
	await vitest.close();
	process.chdir(oldCwd);
	console.debug("Done.");

	console.debug("Uploading test results...");
	// fs.cp doesn't like you copying into yourself, but the proper cp command is cool with it.
	// We have to do this because @vitest/ui tries to serve from a base of `/__vitest__`.
	await shellac`
		$$ cp -r ${TEST_RESULTS_PATH} ${join(TEST_RESULTS_PATH, "__vitest__")}
	`;
	const testResultsDeployment = await unstable_pages.publish({
		directory: TEST_RESULTS_PATH,
		accountId: CLOUDFLARE_ACCOUNT_ID,
		projectName: PAGES_PROJECT_NAME,
		branch: TEST_RESULTS_BRANCH_NAME,
		commitMessage: `${GIT_COMMIT_MESSAGE} ${deploymentURL}`,
		commitHash: GIT_COMMIT_HASH,
	});
	console.debug("Done.", testResultsDeployment.url);
};

main().finally(async () => {
	const results = await Promise.allSettled(
		cleanupFunctions.map((cleanUpFunction) => cleanUpFunction())
	);
	console.debug("Cleanup complete.");
	if (!results.every((result) => result.status === "fulfilled")) {
		console.warn("Some cleanup tasks did not complete successfully.");
	}
});
