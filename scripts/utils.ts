export const transformResponseIntoError = async (
	response: Response,
	responseText: string,
	message?: string
) => {
	return `${message ? `${message}\n\n` : ""}${response.status} ${
		response.statusText
	}\n${responseText}`;
};

export const noMakeCommandStderr = (name: string) =>
	`make: *** No rule to make target \`${name}'.  Stop.`;

export const responseIsNotProvisioned = async (response: Response) => {
	const text = await response.text();
	console.debug("Checking the following response to see if it is provisioned:");
	console.debug(text);
	return (
		text.includes("Nothing is here yet") && text.includes("Cloudflare Pages")
	);
};

export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60 * ONE_SECOND;
