import { ok } from "assert";
import shellac from "shellac";
import {
	DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD,
	DEPLOYMENT_CHECK_INTERVAL,
	DEPLOYMENT_TIMEOUT,
	Environment,
	GIT_EMAIL_ADDRESS,
	GIT_USERNAME,
	HOSTS,
	PAGES_PROJECTS,
	PROVISIONER_CHECK_INTERVAL,
	PROVISIONER_TIMEOUT,
	Trigger,
} from "./config";
import { Logger } from "./logger";
import { acquireMutex, releaseMutex } from "./mutexes";
import { TeardownService } from "./teardownService";
import { responseIsNotProvisioned, transformResponseIntoError } from "./utils";

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

export const createDeployment = async ({
	timestamp,
	environment,
	trigger,
	logger,
	teardownService,
	fixture,
	directory,
}: {
	timestamp: number;
	environment: Environment;
	trigger: Trigger;
	logger: Logger;
	teardownService: TeardownService;
	fixture: string;
	directory: string;
}) => {
	if (environment === Environment.Local) {
		// TODO
	} else {
		const host = HOSTS[environment];
		ok(host);
		const pagesProject = PAGES_PROJECTS[environment][trigger];
		ok(pagesProject);

		let id: string;
		if (trigger !== Trigger.DirectUpload) {
			ok(pagesProject.GIT_REPO);

			const gitBranchName = `${fixture}-${timestamp}`;
			const gitCommitMessage = `${fixture} @ ${timestamp}`;
			logger.log(
				`Creating Git repo in ${directory}, configuring ${pagesProject.GIT_REPO} remote, checking out orphan branch ${gitBranchName}, adding files, committing, and pushing...`
			);
			await shellac.in(directory)`
				$ git init .
				stdout >> ${logger.info}
				$ git remote add origin ${pagesProject.GIT_REPO}
				stdout >> ${logger.info}
				$ git checkout --orphan ${gitBranchName}
				stdout >> ${logger.info}
				$ git add .
				stdout >> ${logger.info}
				$ git -c user.name="${GIT_USERNAME}" -c user.email="${GIT_EMAIL_ADDRESS}" commit -m "${gitCommitMessage}" --author="${GIT_USERNAME} <${GIT_EMAIL_ADDRESS}> --date=${timestamp}"
				stdout >> ${logger.info}
				$ git push -f origin ${gitBranchName}
				stdout >> ${logger.info}
		`;
			logger.info("Done.");
			teardownService.register({
				name: "Delete Git branch",
				function: async () => {
					console.info("Deleting Git branch...");
					await shellac.in(directory)`
						$ git push origin --delete ${gitBranchName}
						stdout >> ${logger.info}
				`;
					console.info("Done.");
				},
			});

			logger.log("Creating Deploy Hook...");
			let deployHookCreationResponse: Response;
			let deployHookCreationResponseText: string;
			let deployHookId: string;
			try {
				deployHookCreationResponse = await fetch(
					`${host.api}/client/v4/accounts/${pagesProject.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${pagesProject.PROJECT_NAME}/deploy_hooks`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${pagesProject.CLOUDFLARE_API_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: gitBranchName,
							branch: gitBranchName,
						}),
					}
				);

				deployHookCreationResponseText =
					await deployHookCreationResponse.text();

				const {
					result: { hook_id: hookId },
				} = JSON.parse(
					deployHookCreationResponseText
				) as CreateDeployHookResponse;

				ok(hookId);
				deployHookId = hookId;
			} catch {
				throw await transformResponseIntoError(
					deployHookCreationResponse,
					deployHookCreationResponseText,
					"Could not create Deploy Hook."
				);
			}
			logger.info("Created Deploy Hook.", deployHookId);
			teardownService.register({
				name: "Delete Deploy Hook",
				function: async () => {
					logger.info("Deleting Deploy Hook...");
					const deployHookDeletionResponse = await fetch(
						`${host.api}/client/v4/accounts/${pagesProject.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${pagesProject.PROJECT_NAME}/deploy_hooks/${deployHookId}`,
						{
							method: "DELETE",
							headers: {
								Authorization: `Bearer ${pagesProject.CLOUDFLARE_API_TOKEN}`,
							},
						}
					);
					ok(deployHookDeletionResponse.ok);
					logger.info("Done.");
				},
			});

			const mutexKey = encodeURIComponent(
				`${host.api}:${pagesProject.CLOUDFLARE_ACCOUNT_ID}:${pagesProject.PROJECT_NAME}`
			);
			logger.log(`Aquiring Mutex for \`${mutexKey}\`...`);
			const mutex = await acquireMutex({ logger, key: mutexKey });
			logger.info("Done.", mutex);

			logger.log(`Creating Deployment with Deploy Hook ${deployHookId}...`);
			let deployHookResponse: Response;
			let deployHookResponseText: string;
			try {
				deployHookResponse = await fetch(
					`${host.api}/client/v4/pages/webhooks/deploy_hooks/${deployHookId}`,
					{
						method: "POST",
					}
				);

				deployHookResponseText = await deployHookResponse.text();

				const { result } = JSON.parse(
					deployHookResponseText
				) as DeployHookResponse;

				ok(result.id);
				id = result.id;
			} catch {
				throw await transformResponseIntoError(
					deployHookResponse,
					deployHookResponseText,
					"Could not create Deployment."
				);
			}
			logger.info("Created Deployment.", id);

			logger.log("Releasing Mutex...");
			try {
				await releaseMutex({ mutex });
			} catch (thrown) {
				logger.warn(thrown);
			}
			logger.info("Done.");
		} else {
			// TODO
		}

		logger.log(`Awaiting Deployment ${id} completion...`);
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
						`${host.api}/client/v4/accounts/${pagesProject.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${pagesProject.PROJECT_NAME}/deployments/${id}`,
						{
							headers: {
								Authorization: `Bearer ${pagesProject.CLOUDFLARE_API_TOKEN}`,
							},
						}
					);

					deploymentResponseText = await deploymentResponse.text();

					const {
						result: { url, latest_stage: latestStage },
					} = JSON.parse(deploymentResponseText) as DeploymentResponse;

					ok(url);
					ok(latestStage.status);

					if (
						latestStage.name === "deploy" &&
						latestStage.status === "success"
					) {
						resolveWithDeploymentSuccess(url);
					} else if (
						!["idle", "active", "success"].includes(latestStage.status)
					) {
						rejectWithDeploymentFailure(
							new Error(
								`Deployment ${id} has failed.\n\nStage: ${latestStage.name}\nStatus: ${latestStage.status}\n\n${host.dash}/${pagesProject.CLOUDFLARE_ACCOUNT_ID}/pages/view/${pagesProject.PROJECT_NAME}/${id}`
							)
						);
					} else {
						logger.debug(
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
						logger.error(
							`Number of not-OK Deployment API responses exceeded allowed threshold ${DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD}. Erroring...`
						);
						throw error;
					} else {
						logger.debug(
							`Received a not-OK Deployment API response, ${notOkResponses} of a maximum ${DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD}. Suppressing error...`
						);
						logger.debug(error);
					}
				}
			})();
		}, DEPLOYMENT_CHECK_INTERVAL);

		const url = await new Promise<string>((resolve, reject) => {
			resolveWithDeploymentSuccess = (...args) => {
				clearInterval(deploymentCheckInterval);
				resolve(...args);
			};
			rejectWithDeploymentFailure = (...args) => {
				clearInterval(deploymentCheckInterval);
				reject(...args);
			};
		});
		logger.log("Deployment complete.", id);

		if (environment === Environment.Production) {
			await waitForDeploymentToBeProvisioned({ logger, url });
		}

		return { url };
	}

	async function waitForDeploymentToBeProvisioned({
		logger,
		url,
	}: {
		logger: Logger;
		url: string;
	}) {
		logger.log(`Awaiting ${url} to be live at the edge...`);
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
					const response = await fetch(url);
					const deploymentIsNotProvisioned = await responseIsNotProvisioned({
						logger,
						response,
					});

					if (deploymentIsNotProvisioned) {
						logger.debug("Deployment is not yet available at the edge.");
					} else {
						resolveWithProvisionerSuccess();
					}
				} catch {
					logger.debug("Could not check the deployment URL.");
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
		logger.log("Deployment available.", url);
	}
};
