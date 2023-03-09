#!/usr/bin/env node

const { resolve, join } = require("path");
const { spawn } = require("child_process");

let extraCACerts =
	process.env.NODE_EXTRA_CA_CERTS ||
	resolve(join(__dirname, "../assets/Cloudflare_CA.pem"));

spawn(
	process.execPath,
	[
		"--loader",
		"tsm",
		resolve(join(__dirname, "../scripts/run-test.ts")),
		...process.argv.slice(2),
	],
	{
		stdio: "inherit",
		env: {
			...process.env,
			NODE_EXTRA_CA_CERTS: extraCACerts,
		},
	}
);
