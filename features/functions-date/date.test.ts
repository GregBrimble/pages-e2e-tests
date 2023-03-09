import { describe, it } from "vitest";

describe("Pages Functions `functions/` directory", () => {
	it("routes a simple file path and method correctly", async ({ expect }) => {
		const response = await fetch(`${DEPLOYMENT_URL}/date`);
		expect(
			(await response.text()).match(
				/\d\d\d\d-\d\d\-\d\dT\d\d:\d\d:\d\d.\d\d\dZ/
			)
		).toBeTruthy();
	});

	it("doesn't route simple pages where they're not supposed to be", async ({
		expect,
	}) => {
		let response = await fetch(`${DEPLOYMENT_URL}/foo`);
		expect(
			(await response.text()).match(
				/\d\d\d\d-\d\d\-\d\dT\d\d:\d\d:\d\d.\d\d\dZ/
			)
		).toBeFalsy();

		response = await fetch(`${DEPLOYMENT_URL}/date`, { method: "POST" });
		expect(
			(await response.text()).match(
				/\d\d\d\d-\d\d\-\d\dT\d\d:\d\d:\d\d.\d\d\dZ/
			)
		).toBeFalsy();
	});
});
