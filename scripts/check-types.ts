import concurrently from "concurrently";
import { globby } from "globby";
import { dirname, relative } from "path";
import { fileURLToPath } from "url";

const DIRNAME = fileURLToPath(new URL("../", import.meta.url));

const tsconfigFiles = await globby("**/tsconfig.json", { gitignore: true });

concurrently(
	tsconfigFiles.map((tsconfig) => ({
		command: `npx tsc -p ${tsconfig}`,
		name: `/${relative(DIRNAME, dirname(tsconfig))}`,
	})),
	{
		group: true,
	}
);
