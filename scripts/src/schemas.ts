import { z } from "zod";

const date = z.string().regex(/^\d{4}-[01]\d-[0123]\d$/);

const uuidv4 = z
	.string()
	.regex(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
	);

const hex32 = z.string().regex(/^[0-9a-f]{32}$/i);

export const fixturesSchema = z
	.object({
		features: z
			.array(z.string().nonempty())
			.default([])
			.describe("The features to apply to this fixture project."),
		setup: z.optional(
			z
				.string()
				.describe(
					"The command to run ahead of time in order to configure this fixture project."
				)
		),
		buildConfig: z
			.object({
				buildCommand: z
					.string()
					.default("")
					.describe("The command to run to build the project."),
				buildOutputDirectory: z
					.string()
					.default("")
					.describe("The directory of static assets to serve in a deployment."),
				rootDirectory: z
					.string()
					.default("")
					.describe("The root directory of the project."),
			})
			.describe("The build configuration to use when building the project."),
		deploymentConfig: z
			.object({
				environmentVariables: z
					.record(z.string().describe("The value of the environment variable."))
					.default({})
					.describe(
						"The environment variables available when building and at runtime in Pages Functions."
					),
				compatibilityDate: date
					.default("2023-03-26")
					.describe("The runtime compatibility date for Pages Functions."),
				compatibilityFlags: z
					.array(z.string().nonempty())
					.default([])
					.describe("The runtime compatibility flags for Pages Functions."),
				d1Databases: z
					.record(
						z
							.object({
								production: z
									.object({
										id: uuidv4.describe("The ID of the D1 database."),
									})
									.describe("The production D1 database."),
								staging: z
									.object({
										id: uuidv4.describe("The ID of the D1 database."),
									})
									.describe("The staging D1 database."),
							})
							.describe("The D1 database binding.")
					)
					.default({})
					.describe("The D1 databases for Pages Functions."),
				durableObjectNamespaces: z
					.record(
						z
							.object({
								production: z
									.object({
										id: hex32.describe(
											"The ID of the Durable Object namespace."
										),
									})
									.describe("The production Durable Object namespace."),
								staging: z
									.object({
										id: hex32.describe(
											"The ID of the Durable Object namespace."
										),
									})
									.describe("The staging Durable Object namespace."),
							})
							.describe("The Durable Object namespace binding.")
					)
					.default({})
					.describe("The Durable Object namespaces for Pages Functions."),
				kvNamespaces: z
					.record(
						z
							.object({
								production: z
									.object({
										id: hex32.describe("The ID of the KV namespace."),
									})
									.describe("The production KV namespace."),
								staging: z
									.object({
										id: hex32.describe("The ID of the KV namespace."),
									})
									.describe("The staging KV namespace."),
							})
							.describe("The KV namespace binding.")
					)
					.default({})
					.describe("The KV namespaces for Pages Functions."),
				r2Buckets: z
					.record(
						z
							.object({
								production: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the R2 bucket."),
									})
									.describe("The production R2 bucket."),
								staging: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the R2 bucket."),
									})
									.describe("The staging R2 bucket."),
							})
							.describe("The R2 bucket binding.")
					)
					.default({})
					.describe("The R2 buckets for Pages Functions."),
				services: z
					.record(
						z
							.object({
								production: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the Service."),
										environment: z
											.string()
											.nonempty()
											.describe("The environment of the Service."),
									})
									.describe("The production Service."),
								staging: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the Service."),
										environment: z
											.string()
											.nonempty()
											.describe("The environment of the Service."),
									})
									.describe("The staging Service."),
							})
							.describe("The Service binding.")
					)
					.default({})
					.describe("The Services for Pages Functions."),
				queueProducers: z
					.record(
						z
							.object({
								production: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the Queue."),
									})
									.describe("The production Queue."),
								staging: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the Queue."),
									})
									.describe("The staging Queue."),
							})
							.describe("The Queue Producer binding.")
					)
					.default({})
					.describe("The Queue Producers for Pages Functions."),
				analyticsEngineDatasets: z
					.record(
						z
							.object({
								production: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the Analytics Engine dataset."),
									})
									.describe("The production Analytics Engine dataset."),
								staging: z
									.object({
										name: z
											.string()
											.nonempty()
											.describe("The name of the Analytics Engine dataset."),
									})
									.describe("The staging Analytics Engine dataset."),
							})
							.describe("The Analytics Engine dataset binding.")
					)
					.default({})
					.describe("The Analytics Engine datasets for Pages Functions."),
			})
			.default({})
			.describe(
				"The deployment configuration to use when deploying the project."
			),
	})
	.describe("A project fixture.");

export type FixtureConfig = z.TypeOf<typeof fixturesSchema>;
