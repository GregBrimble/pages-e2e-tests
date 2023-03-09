import { describe, it } from "vitest";

describe("Deployment URL", () => {
	it("can be reached", async ({ expect }) => {
		const response = await fetch(DEPLOYMENT_URL);
		console.log(
			`GET ${DEPLOYMENT_URL}\n${response.status} ${
				response.statusText
			}\n\n${await response.text()}`
		);
		expect(response.ok).toBeTruthy();
	});
});
