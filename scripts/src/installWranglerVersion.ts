import shellac from "shellac";
import { CWD } from "./config";
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
	logger.log(`Installing wrangler@${version}...`);
	await shellac.in(CWD)`
		$ export NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}
		$ npm install --no-save wrangler@${version}
		stdout >> ${logger.info}
		$ npx wrangler --version
		stdout >> ${logger.info}
	`;
	logger.info("Done.");

	teardownService.register({
		name: "Reinstall dependencies",
		function: async () => {
			await shellac.in(CWD)`
				$ export NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}
				$ npm install
				stdout >> ${logger.info}
		`;
		},
	});
};
