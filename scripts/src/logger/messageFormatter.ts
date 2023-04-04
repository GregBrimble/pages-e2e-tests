import chalk from "chalk";
import { LogLevel } from "./logger";

const green = "#8dca79";
const yellow = "#e5ce88";
const red = "#dc322f";
const purple = "#a8abe3";

const info = chalk.hex(green).bold;
const warn = chalk.hex(yellow).bold;
const error = chalk.hex(red).bold;
const debug = chalk.hex(purple).bold;

export function formatMessage(
	level: LogLevel,
	message: string,
	showTimestamp = true
): string {
	const timestamp = showTimestamp ? getTimestamp() : "";
	const logLevelPrefix = getPrefix(level);

	return `${timestamp} ${logLevelPrefix} ${message}`.trim();
}

export function formatLabel(labelText: string, hexColor = yellow): string {
	return chalk.bgHex(hexColor)(` ${labelText} `);
}

/**
 * Returns a pre-styled prefix based on a given log level
 */
function getPrefix(level: LogLevel): string {
	switch (level) {
		case LogLevel.debug:
			return debug("DEBUG");
		case LogLevel.info:
			return info("INFO");
		case LogLevel.warn:
			return warn("WARN");
		case LogLevel.error:
			return error("ERROR");
		default:
			return "";
	}
}

function getTimestamp(): string {
	// not sure what makes sense to return here,
	// so returning ISO string for now
	return new Date().toISOString();
}
