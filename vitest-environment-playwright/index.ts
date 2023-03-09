import { chromium } from "playwright";
import { Environment } from "vitest";

export default <Environment>{
	name: "playwright",
	async setup(global) {
		global.BROWSER = await chromium.launch({ headless: true });
		return {
			async teardown() {
				await global.BROWSER.close();
			},
		};
	},
};
