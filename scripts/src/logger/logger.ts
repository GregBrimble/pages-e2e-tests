import { formatLabel, formatMessage } from "./messageFormatter";

export enum LogLevel {
	debug = 0,
	info = 1,
	log = 2,
	warn = 3,
	error = 4,
}
export type LoggerLevel = keyof typeof LogLevel;

export class Logger {
	label: string;
	level: LogLevel;
	private messages: [LogLevel, ...any][] = [];
	collect: boolean;
	children: Logger[] = [];

	constructor({
		level,
		label,
		collect = false,
	}: {
		level: LogLevel;
		label?: string;
		collect?: boolean;
	}) {
		this.level = level;
		this.label = label;
		this.collect = collect;
	}

	static from({
		logger,
		level,
		label,
		collect,
	}: {
		logger: Logger;
		level?: LogLevel;
		label?: string;
		collect?: boolean;
	}) {
		const newLogger = new Logger({
			level: level ?? logger.level,
			label:
				label && logger.label
					? `${label} ${logger.label}`
					: label ?? logger.label,
			collect: collect ?? logger.collect,
		});
		logger.children.push(newLogger);
		return newLogger;
	}

	flush() {
		if (this.collect) {
			this.messages.forEach(([level, ...args]) => {
				this.doLog(level, ...args);
			});
		}
		this.children.forEach((child) => child.flush());
	}

	debug = (...args: any[]) => this.doLog(LogLevel.debug, ...args);
	info = (...args: any[]) => this.doLog(LogLevel.info, ...args);
	log = (...args: any[]) => this.doLog(LogLevel.log, ...args);
	warn = (...args: any[]) => this.doLog(LogLevel.warn, ...args);
	error = (...args: any[]) => this.doLog(LogLevel.error, ...args);

	private doLog(level: LogLevel, ...args: any[]) {
		if (level >= this.level) {
			if (this.collect) {
				this.messages.push([level, ...args]);
			} else {
				let message = "";
				const logLevel = LogLevel[level];

				console.log();

				if (this.label) {
					message = formatLabel(this.label);
				} else {
					// is this the right assumption to make here?
					message = [...args].flat(1).shift();
				}
				console[logLevel](formatMessage(level, message), ...args);

				// console[LogLevel[level]](
				// 	...[this.label ? [this.label, ...args] : [...args]].flat(1)
				// );
			}
		}
	}
}
