import { readFile } from "fs/promises";
import { join } from "path";
import shellac from "shellac";
import stripJsonComments from "strip-json-comments";
import { Logger } from "./logger/logger";
import { FeatureConfig, featuresSchema } from "./schemas";

export interface Feature {
	name: string;
	path: string;
}

export type FeaturesConfig = Pick<Required<FeatureConfig>, "deploymentConfig">;

export const setUpFeatures = async ({
	logger,
	features,
	directory,
}: {
	logger: Logger;
	features: Feature[];
	directory: string;
}) => {
	const featuresConfig: FeaturesConfig = {
		deploymentConfig: {
			environmentVariables: {},
			d1Databases: {},
			durableObjectNamespaces: {},
			kvNamespaces: {},
			r2Buckets: {},
			services: {},
			queueProducers: {},
		},
	};

	if (features.length > 0) {
		logger.log(
			`Fixture features detected. Adding ${features
				.map(({ name }) => name)
				.join(", ")}...`
		);

		for (const { name, path } of features) {
			logger.log("Reading fixture config...");
			const config = featuresSchema.parse(
				JSON.parse(
					stripJsonComments(await readFile(join(path, "main.feature"), "utf-8"))
				)
			);
			logger.info("Done.");

			featuresConfig.deploymentConfig = {
				environmentVariables: {
					...featuresConfig.deploymentConfig.environmentVariables,
					...config.deploymentConfig.environmentVariables,
				},
				d1Databases: {
					...featuresConfig.deploymentConfig.d1Databases,
					...config.deploymentConfig.d1Databases,
				},
				durableObjectNamespaces: {
					...featuresConfig.deploymentConfig.durableObjectNamespaces,
					...config.deploymentConfig.durableObjectNamespaces,
				},
				kvNamespaces: {
					...featuresConfig.deploymentConfig.kvNamespaces,
					...config.deploymentConfig.kvNamespaces,
				},
				r2Buckets: {
					...featuresConfig.deploymentConfig.r2Buckets,
					...config.deploymentConfig.r2Buckets,
				},
				services: {
					...featuresConfig.deploymentConfig.services,
					...config.deploymentConfig.services,
				},
				queueProducers: {
					...featuresConfig.deploymentConfig.queueProducers,
					...config.deploymentConfig.queueProducers,
				},
			};

			logger.log(`Setting up feature ${name}...`);
			if (config.setup) {
				await shellac.in(path)`
					$ export NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}
					$ export WORKSPACE_DIR=${directory}
					$ ${config.setup}
					stdout >> ${logger.info}
				`;
			} else {
				logger.info("No setup command found. Continuing...");
			}
			logger.info("Done.");
		}

		logger.info("Done.");
	}

	return { config: featuresConfig };
};
