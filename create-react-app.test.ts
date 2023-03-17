import { describe, it } from "vitest";

describe("create-react-app", () => {
	it("should render the Learn React link", async ({ expect }) => {
		const page = await BROWSER.newPage();
		await page.goto(DEPLOYMENT_URL);
		const element = await page.waitForSelector(".App-link");
		expect(await element.innerText()).toMatch(/learn react/i);
		expect(await element.getAttribute("href")).toMatchInlineSnapshot(
			'"https://reactjs.org"'
		);
	});
});
