import assert, { ok } from "assert";
import shellac from "shellac";
import {
	DEPLOYMENT_CHECK_API_FAILURES_THRESHOLD,
	DEPLOYMENT_CHECK_INTERVAL,
	DEPLOYMENT_TIMEOUT,
	Environment,
	GIT_EMAIL_ADDRESS,
	GIT_USERNAME,
	Host,
	HOSTS,
	PagesProjectCredentials,
	PAGES_PROJECTS,
	PROVISIONER_CHECK_INTERVAL,
	PROVISIONER_TIMEOUT,
	Trigger,
} from "./config";
import { Logger } from "./logger";
import { acquireMutex, releaseMutex } from "./mutexes";
import { FixtureConfig } from "./schemas";
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

interface Project {
	build_config: {
		build_command: string;
		destination_dir: string;
		root_dir: string;
	};
	deployment_configs: {
		preview: {
			env_vars: Record<string, { type: "plain_text"; value: string }> | null;
			compatibility_date: string;
			compatibility_flags: string[];
			d1_databases?: Record<
				string,
				{
					id: string;
				}
			>;
			durable_object_namespaces?: Record<string, { namespace_id: string }>;
			kv_namespaces?: Record<string, { namespace_id: string }>;
			r2_buckets?: Record<string, { name: string }>;
			services?: Record<string, { service: string; environment: string }>;
			queue_producers?: Record<string, { name: string }>;
			analytics_engine_datasets?: Record<string, { dataset: string }>;
		};
	};
	source?: {
		type: "github" | "gitlab";
		config: {
			owner: string;
			repo_name: string;
			production_branch: string;
			deployments_enabled: true;
			production_deployments_enabled: false;
			preview_deployment_setting: "none";
		};
	};
}

interface ProjectResponse {
	result: Project;
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
	fixtureConfig,
	directory,
}: {
	timestamp: number;
	environment: Environment;
	trigger: Trigger;
	logger: Logger;
	teardownService: TeardownService;
	fixture: string;
	fixtureConfig: FixtureConfig;
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

			await configureProject({
				logger,
				host,
				projectCredentials: pagesProject,
				fixtureConfig,
			});

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

	async function configureProject({
		logger,
		host,
		projectCredentials,
		fixtureConfig,
	}: {
		logger: Logger;
		host: Host;
		projectCredentials: PagesProjectCredentials;
		fixtureConfig: FixtureConfig;
	}) {
		ok([Environment.Production, Environment.Staging].includes(environment));

		logger.log("Configuring project...");
		logger.info("Getting initial project state...");
		let initialResponse: Response;
		let initialResponseText: string;
		let initialProject: Project;
		try {
			initialResponse = await fetch(
				`${host.api}/client/v4/accounts/${projectCredentials.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectCredentials.PROJECT_NAME}`,
				{
					headers: {
						Authorization: `Bearer ${projectCredentials.CLOUDFLARE_API_TOKEN}`,
					},
				}
			);
			initialResponseText = await initialResponse.text();

			initialProject = (JSON.parse(initialResponseText) as ProjectResponse)
				.result;

			ok(initialProject);
		} catch {
			throw await transformResponseIntoError(
				initialResponse,
				initialResponseText
			);
		}
		logger.info("Done.", initialProject);

		logger.info("Computing required changes...");
		const updatePayload: Project = {
			build_config: {
				build_command: fixtureConfig.buildConfig.buildCommand || "",
				destination_dir: fixtureConfig.buildConfig.buildOutputDirectory || "",
				root_dir: fixtureConfig.buildConfig.rootDirectory || "",
			},
			deployment_configs: {
				preview: {
					env_vars: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview.env_vars || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(
								fixtureConfig.deploymentConfig.environmentVariables
							).map(([name, value]) => [name, { type: "plain_text", value }])
						),
					},
					compatibility_date: fixtureConfig.deploymentConfig.compatibilityDate,
					compatibility_flags:
						fixtureConfig.deploymentConfig.compatibilityFlags,
					d1_databases: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview.d1_databases || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(fixtureConfig.deploymentConfig.d1Databases).map(
								([name, value]) => [name, value[environment]]
							)
						),
					},
					durable_object_namespaces: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview
									.durable_object_namespaces || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(
								fixtureConfig.deploymentConfig.durableObjectNamespaces
							).map(([name, value]) => [
								name,
								{
									namespace_id: value[environment].id,
								},
							])
						),
					},
					kv_namespaces: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview.kv_namespaces || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(fixtureConfig.deploymentConfig.kvNamespaces).map(
								([name, value]) => [
									name,
									{
										namespace_id: value[environment].id,
									},
								]
							)
						),
					},
					r2_buckets: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview.r2_buckets || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(fixtureConfig.deploymentConfig.r2Buckets).map(
								([name, value]) => [name, value[environment]]
							)
						),
					},
					services: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview.services || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(fixtureConfig.deploymentConfig.services).map(
								([name, value]) => [
									name,
									{
										service: value[environment].name,
										environment: value[environment].environment,
									},
								]
							)
						),
					},
					queue_producers: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview.queue_producers || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(fixtureConfig.deploymentConfig.queueProducers).map(
								([name, value]) => [name, value[environment]]
							)
						),
					},
					analytics_engine_datasets: {
						...Object.fromEntries(
							Object.keys(
								initialProject.deployment_configs.preview
									.analytics_engine_datasets || {}
							).map((name) => [name, null])
						),
						...Object.fromEntries(
							Object.entries(
								fixtureConfig.deploymentConfig.analyticsEngineDatasets
							).map(([name, value]) => [
								name,
								{
									dataset: value[environment].name,
								},
							])
						),
					},
				},
			},
		};
		logger.info("Done.", updatePayload);

		logger.info("Updating project...");
		let projectResponse: Response;
		let projectResponseText: string;
		let project: Project;
		try {
			projectResponse = await fetch(
				`${host.api}/client/v4/accounts/${projectCredentials.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectCredentials.PROJECT_NAME}`,
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${projectCredentials.CLOUDFLARE_API_TOKEN}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(updatePayload),
				}
			);

			projectResponseText = await projectResponse.text();

			project = (JSON.parse(projectResponseText) as ProjectResponse).result;

			ok(
				project.build_config.build_command ===
					fixtureConfig.buildConfig.buildCommand,
				"Build command was not set correctly."
			);
			ok(
				project.build_config.destination_dir ===
					fixtureConfig.buildConfig.buildOutputDirectory,
				"Build output directory was not set correctly."
			);
			ok(
				project.build_config.root_dir ===
					fixtureConfig.buildConfig.rootDirectory,
				"Root directory was not set correctly."
			);

			assert.deepStrictEqual(
				Object.entries(project.deployment_configs.preview.env_vars || {}),
				Object.entries(fixtureConfig.deploymentConfig.environmentVariables).map(
					([name, value]) => [name, { type: "plain_text", value }]
				),
				"Environment variables were not set correctly."
			);
			assert.deepStrictEqual(
				project.deployment_configs.preview.compatibility_date,
				fixtureConfig.deploymentConfig.compatibilityDate,
				"Compatibility date was not set correctly."
			);
			assert.deepStrictEqual(
				project.deployment_configs.preview.compatibility_flags,
				fixtureConfig.deploymentConfig.compatibilityFlags,
				"Compatibility flags were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(project.deployment_configs.preview.d1_databases || {}),
				Object.entries(fixtureConfig.deploymentConfig.d1Databases).map(
					([name, value]) => [name, value[environment]]
				),
				"D1 database bindings were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(
					project.deployment_configs.preview.durable_object_namespaces || {}
				),
				Object.entries(
					fixtureConfig.deploymentConfig.durableObjectNamespaces
				).map(([name, value]) => [
					name,
					{ namespace_id: value[environment].id },
				]),
				"Durable Object namespace bindings were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(project.deployment_configs.preview.kv_namespaces || {}),
				Object.entries(fixtureConfig.deploymentConfig.kvNamespaces).map(
					([name, value]) => [name, { namespace_id: value[environment].id }]
				),
				"KV namespace bindings were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(project.deployment_configs.preview.r2_buckets || {}),
				Object.entries(fixtureConfig.deploymentConfig.r2Buckets).map(
					([name, value]) => [name, value[environment]]
				),
				"R2 bucket bindings were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(project.deployment_configs.preview.services || {}),
				Object.entries(fixtureConfig.deploymentConfig.services).map(
					([name, value]) => [
						name,
						{
							service: value[environment].name,
							environment: value[environment].environment,
						},
					]
				),
				"Service bindings were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(
					project.deployment_configs.preview.queue_producers || {}
				),
				Object.entries(fixtureConfig.deploymentConfig.queueProducers).map(
					([name, value]) => [name, value[environment]]
				),
				"Queue Producer bindings were not set correctly."
			);
			assert.deepStrictEqual(
				Object.entries(
					project.deployment_configs.preview.analytics_engine_datasets || {}
				),
				Object.entries(
					fixtureConfig.deploymentConfig.analyticsEngineDatasets
				).map(([name, value]) => [
					name,
					{
						dataset: value[environment].name,
					},
				]),
				"Analytics Engine dataset bindings were not set correctly."
			);
		} catch (e) {
			throw await transformResponseIntoError(
				projectResponse,
				projectResponseText,
				`${e}`
			);
		}
		logger.info("Done.", project);
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
