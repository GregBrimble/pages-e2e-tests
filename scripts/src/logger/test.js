/**
 * FOR TESTING PURPOSES ONLY! PLS REMOVE!
 */

import chalk from "chalk";

const info = chalk.hex("#8dca79").bold; // green
const warn = chalk.hex("#e5ce88").bold; // yellow
const error = chalk.hex("#dc322f").bold; // red
const debug = chalk.hex("#a8abe3").bold; // purple

const label = chalk.bgYellow.bold;

function getPrefix(level) {
	switch (level) {
		case 0:
			return debug("DEBUG");
		case 1:
			return info("INFO");
		case 3:
			return warn("WARN");
		case 4:
			return error("ERROR");
		default:
			return "";
	}
}

function getTimestamp() {
	// not sure what makes sense to return here,
	// so returning ISO string for now
	return new Date().toISOString();
}

function formatMessage(level, message, showTimestamp) {
	const timestamp = showTimestamp ? getTimestamp() : "";
	const logLevelPrefix = getPrefix(level);

	return `${timestamp} ${logLevelPrefix} ${message}`.trim();
}

function formatLabel(labelText, hexColor) {
	return chalk.bgHex(hexColor)(` ${labelText} `);
}

console.log(formatMessage(0, "Hello debug", true));
console.log(formatMessage(1, "Hello info", true));
console.log(formatMessage(3, "Hello warn", true));
console.log(formatMessage(4, "Hello error", true));
console.log(formatLabel("Hello label", "#e5ce88"));
