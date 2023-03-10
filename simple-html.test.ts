import { describe, it } from "vitest";

const { DEPLOYMENT_URL } = process.env;

describe("simple-html", () => {
	it("serves index.html at the root", async ({ expect }) => {
		const response = await fetch(DEPLOYMENT_URL);
		expect(await response.text()).toMatchInlineSnapshot(`
			"<h1>Hello, world!</h1>
			"
		`);
	});
});
