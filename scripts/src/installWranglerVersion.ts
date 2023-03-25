import shellac from "shellac";
import { DIRNAME } from "./config";
import { Logger } from "./logger";
import { TeardownService } from "./teardownService";

export const installWranglerVersion = async ({
	logger,
	teardownService,
	version,
}: {
	logger: Logger;
	teardownService: TeardownService;
	version: string;
}) => {
	logger.log("Installing wrangler version...");
	await shellac.in(DIRNAME)`
		$ npm install --no-save wrangler@${version}
		stdout >> ${logger.info}
		$ npx wrangler --version
		stdout >> ${logger.info}
	`;
	logger.info("Done.");

	teardownService.register({
		name: "Reinstall dependencies",
		function: async () => {
			await shellac.in(DIRNAME)`
				$ npm install
				stdout >> ${logger.info}
		`;
		},
	});
};
