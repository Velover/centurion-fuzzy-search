import {
	ArgumentOptions,
	BaseRegistry,
	CommandOptions,
	ListArgumentType,
	RegistryPath,
	SingleArgumentType,
} from "@rbxts/centurion";
import { ReadonlyDeep } from "@rbxts/centurion/out/shared/util/data";
import { FuzzySearch } from "@rbxts/fuzzy-search";
import { Players } from "@rbxts/services";
import { ArgumentSuggestion, CommandSuggestion } from "../../types";
import { containsSpace, getQuoteChar } from "../../utils/string";

export interface SingleArgument {
	kind: "single";
	options: ReadonlyDeep<ArgumentOptions>;
	type: SingleArgumentType<unknown>;
	input?: string;
}

export interface ListArgument {
	kind: "list";
	options: ReadonlyDeep<ArgumentOptions>;
	type: ListArgumentType<unknown>;
	input?: string[];
}

export type Argument = SingleArgument | ListArgument;

function getMatches(
	strings: string[],
	text?: string,
): [number, string, number][] {
	if (text === undefined) {
		return strings.sort().map((str, i) => {
			const formatted = containsSpace(str) ? `"${str}"` : str;
			return [i, formatted, formatted.size()];
		});
	}

	const quoteChar = getQuoteChar(text);
	const quoted = quoteChar !== undefined;

	const processedStrings = strings.map((str) => {
		if (quoted) {
			return `${quoteChar}${str}${quoteChar}`;
		}

		if (containsSpace(str)) {
			return `"${str}"`;
		}

		return str;
	});

	type Result = [number, string, number];

	const results = strings.map((str, i) => [i, str, str.size()]) as Result[];
	const sortedStrings = FuzzySearch.Sorting.FuzzyScore(
		processedStrings,
		text,
		results,
	).filter(([score]) => score > 0);

	return sortedStrings.map(([_, value]) => value);
}

export function getArgumentSuggestion(arg: Argument, textPart?: string) {
	const suggestions =
		arg.options.suggestions !== undefined ? [...arg.options.suggestions] : [];
	const singleArg = arg.kind === "single";

	const typeSuggestions = singleArg
		? arg.type.suggestions?.(arg.input ?? "", Players.LocalPlayer)
		: arg.type.suggestions?.(arg.input ?? [], Players.LocalPlayer);
	if (typeSuggestions !== undefined) {
		for (const text of typeSuggestions) {
			suggestions.push(text);
		}
	}

	let errorText: string | undefined;
	const input = arg.input;
	if (!arg.type.expensive && input !== undefined) {
		const [success, err] = pcall(() => {
			const transformResult = singleArg
				? arg.type.transform(input as string, Players.LocalPlayer)
				: arg.type.transform(input as string[], Players.LocalPlayer);
			if (transformResult.ok) return;
			errorText = transformResult.value;
		});

		if (!success) {
			errorText = "Failed to transform argument";
			warn(err);
		}
	}

	return {
		type: "argument",
		title: arg.options.name,
		others: getMatches(suggestions, textPart).map(([, str]) => str),
		description: arg.options.description,
		dataType: arg.type.name,
		optional: arg.options.optional ?? false,
		error: errorText,
	} satisfies ArgumentSuggestion;
}

export function getCommandSuggestion(
	registry: BaseRegistry,
	parentPath?: RegistryPath,
	text?: string,
): CommandSuggestion | undefined {
	const paths =
		parentPath !== undefined
			? registry.getChildPaths(parentPath)
			: registry.getRootPaths();
	if (paths.isEmpty()) return;

	const pathNames = paths.map((path) => path.tail());
	const sortedPaths = getMatches(pathNames, text);
	const firstMatch = sortedPaths.remove(0);
	if (firstMatch === undefined) return;

	const firstPath = paths[firstMatch[0]];

	const command = registry.getCommand(firstPath);
	if (command !== undefined) {
		return {
			type: "command",
			title: getCommandName(
				command.options as CommandOptions,
				firstPath.tail(),
			),
			description: command.options.description,
			others: sortedPaths.map(([, str]) => str),
			shortcuts: (command.options as CommandOptions).shortcuts,
		};
	}

	const group = registry.getGroup(firstPath);
	if (group !== undefined) {
		return {
			type: "command",
			title: group.options.name,
			description: group.options.description,
			others: sortedPaths.map(([, str]) => str),
		};
	}
}

function getCommandName(options: CommandOptions, input: string) {
	if (input === options.name.lower()) return options.name;

	for (const alias of options.aliases ?? []) {
		if (input === alias.lower()) return alias;
	}
	return input;
}
