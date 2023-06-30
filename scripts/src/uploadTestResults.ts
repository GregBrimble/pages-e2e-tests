import { writeFile } from "fs/promises";
import { join } from "path";
import shellac from "shellac";
import { unstable_pages } from "wrangler";
import {
	TEST_RESULTS_BRANCH_NAME,
	TEST_RESULTS_PAGES_PROJECT,
	TEST_RESULTS_PATH,
} from "./config";
import { Logger } from "./logger";

export const uploadTestResults = async ({
	logger,
	gitCommitMessage,
}: {
	logger: Logger;
	gitCommitMessage: string;
}) => {
	if (
		TEST_RESULTS_PAGES_PROJECT.CLOUDFLARE_ACCOUNT_ID === undefined ||
		TEST_RESULTS_PAGES_PROJECT.PROJECT_NAME === undefined ||
		TEST_RESULTS_PAGES_PROJECT.CLOUDFLARE_API_TOKEN === undefined
	) {
		logger.log(
			"No credentials provided for uploading the test results. Skipping..."
		);
		return;
	}

	logger.log("Uploading test results...");
	// fs.cp doesn't like you copying into yourself, but the proper cp command is cool with it.
	// We have to do this because @vitest/ui tries to serve from a base of `/__vitest__`.
	await shellac`
		$ rsync -Rr ${TEST_RESULTS_PATH} ${join(TEST_RESULTS_PATH, "__vitest__")}
		stdout >> ${logger.info}
	`;
	const testResultsDeployment = await unstable_pages.deploy({
		directory: TEST_RESULTS_PATH,
		accountId: TEST_RESULTS_PAGES_PROJECT.CLOUDFLARE_ACCOUNT_ID,
		projectName: TEST_RESULTS_PAGES_PROJECT.PROJECT_NAME,
		branch: TEST_RESULTS_BRANCH_NAME,
		commitMessage: gitCommitMessage,
	});
	logger.log("Done.", testResultsDeployment.url);

	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`[View report](${testResultsDeployment.url})`
		);
	}

	return { url: testResultsDeployment.url };
};
