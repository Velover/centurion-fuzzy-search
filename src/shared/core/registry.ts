import { CommanderOptions, GroupOptions, TypeOptions } from "../types";
import { MetadataReflect } from "../util/reflect";
import {
	BaseCommand,
	CommandData,
	CommandGroup,
	ExecutableCommand,
} from "./command";
import { MetadataKey } from "./decorators";
import { CommandPath, ImmutableCommandPath } from "./path";

const ROOT_NAME_KEY = "__root__";

export abstract class BaseRegistry {
	protected readonly commands = new Map<string, BaseCommand>();
	protected readonly groups = new Map<string, CommandGroup>();
	protected readonly types = new Map<string, TypeOptions<defined>>();
	protected readonly registeredObjects = new Set<object>();
	protected cachedPaths = new Map<string, CommandPath[]>();
	protected frozen = false;

	init() {
		const builtInTypes =
			script.Parent?.Parent?.FindFirstChild("builtin")?.FindFirstChild("types");
		assert(
			builtInTypes !== undefined,
			"Built-in type container does not exist",
		);
		this.registerContainer(builtInTypes);
	}

	freeze() {
		this.frozen = true;
	}

	registerType<T extends defined>(typeOptions: TypeOptions<T>) {
		assert(!this.frozen, "Registry frozen");
		this.types.set(typeOptions.name, typeOptions);
	}

	registerTypes(...types: TypeOptions<defined>[]) {
		assert(!this.frozen, "Registry frozen");
		for (const options of types) {
			this.registerType(options);
		}
	}

	registerContainer(container: Instance) {
		assert(!this.frozen, "Registry frozen");
		for (const obj of container.GetChildren()) {
			if (!obj.IsA("ModuleScript")) {
				continue;
			}

			const objValue = require(obj);
			if (!typeIs(objValue, "function")) {
				return;
			}

			objValue(this);
		}
	}

	getType(name: string) {
		return this.types.get(name);
	}

	registerCommandsIn(container: Instance) {
		assert(!this.frozen, "Registry frozen");
		for (const obj of container.GetChildren()) {
			if (!obj.IsA("ModuleScript")) {
				return;
			}

			require(obj);
		}

		for (const [commandHolder] of MetadataReflect.metadata) {
			if (this.registeredObjects.has(commandHolder)) {
				continue;
			}

			this.registeredObjects.add(commandHolder);
			this.registerCommandHolder(commandHolder);
		}
	}

	getCommand(path: CommandPath) {
		return this.commands.get(path.toString());
	}

	getChildPaths(path?: CommandPath) {
		return this.cachedPaths.get(path?.toString() ?? ROOT_NAME_KEY) ?? [];
	}

	protected cachePath(path: CommandPath) {
		let cacheKey: string;
		if (path.getSize() === 3) {
			if (!this.cachedPaths.has(path.getRoot())) {
				this.addCacheEntry(
					ROOT_NAME_KEY,
					CommandPath.fromString(path.getRoot()),
				);
			}

			const childPath = path.slice(0, 1);
			this.addCacheEntry(path.getRoot(), childPath);
			cacheKey = childPath.toString();
		} else {
			cacheKey = ROOT_NAME_KEY;
		}

		this.addCacheEntry(cacheKey, path);
	}

	private addCacheEntry(key: string, path: CommandPath) {
		const cache = this.cachedPaths.get(key) ?? [];
		cache.push(path);
		cache.sort((a, b) => a.getTail() < b.getTail());
		this.cachedPaths.set(key, cache);
		return cache;
	}

	getGroup(path: CommandPath) {
		assert(
			path.getSize() < 3,
			`Invalid group path '${path}', a group path has a maximum of 2 parts`,
		);

		const root = this.groups.get(path.getPart(0));
		if (path.getSize() === 1 || root === undefined) {
			return root;
		}

		return root.getGroup(path.getPart(1));
	}

	protected registerCommand(commandData: CommandData, group?: CommandGroup) {
		const options = commandData.metadata.options;
		const path =
			group !== undefined
				? group.getPath().append(options.name)
				: new ImmutableCommandPath([options.name]);

		this.validatePath(path.toString(), true);
		const command = ExecutableCommand.create(
			this,
			ImmutableCommandPath.fromPath(path),
			commandData.commandClass,
			commandData.metadata,
			[...commandData.guards],
		);

		this.commands.set(path.toString(), command);

		if (group !== undefined) {
			group.addCommand(command);
		}

		this.cachePath(path);
	}

	private registerCommandHolder(commandHolder: object) {
		const holderOptions = MetadataReflect.getOwnMetadata<CommanderOptions>(
			commandHolder,
			MetadataKey.CommandHolder,
		);
		const globalGroups = holderOptions?.globalGroups ?? [];
		if (holderOptions?.groups !== undefined) {
			this.registerCommandGroups(holderOptions.groups);
		}

		for (const command of MetadataReflect.getOwnProperties(commandHolder)) {
			const data = CommandData.fromHolder(commandHolder, command);

			// Get registered command group
			let commandGroup: CommandGroup | undefined;
			if (data.group.size() > 0) {
				const groupPath = new CommandPath([...globalGroups, ...data.group]);

				if (groupPath.getSize() > 2) {
					throw `Invalid group for command '${command}': a command can only have 2 groups, found ${groupPath.getSize()}`;
				}

				commandGroup = this.getGroup(groupPath);
				assert(
					commandGroup !== undefined,
					`The group '${groupPath}' assigned to command '${command}' is invalid`,
				);
			}

			this.registerCommand(data, commandGroup);
		}
	}

	protected registerCommandGroups(groups: GroupOptions[]) {
		const childMap = new Map<string, GroupOptions[]>();
		for (const group of groups) {
			if (group.root !== undefined) {
				const childArray = childMap.get(group.root) ?? [];
				childArray.push(group);
				childMap.set(group.root, childArray);
				continue;
			}

			this.validatePath(group.name, false);
			const groupObject = this.createGroup(group);
			this.groups.set(groupObject.path.toString(), groupObject);
		}

		for (const [root, children] of childMap) {
			const rootGroup = this.groups.get(root);
			assert(rootGroup !== undefined, `Parent group '${root}' does not exist'`);

			for (const child of children) {
				const childGroup = this.createGroup(child);
				rootGroup.addGroup(childGroup);
				this.groups.set(childGroup.path.toString(), childGroup);
			}
		}
	}

	protected createGroup(group: GroupOptions) {
		const groupParts: string[] = [];
		if (group.root !== undefined) {
			groupParts.push(group.root);
		}

		groupParts.push(group.name);
		return new CommandGroup(new ImmutableCommandPath(groupParts), group);
	}

	protected validatePath(path: string, isCommand: boolean) {
		const hasCommand = this.commands.has(path);
		if (hasCommand && isCommand) throw `Duplicate command: ${path}`;

		if (hasCommand)
			throw `A command already exists with the same name as this group: ${path}`;

		const hasGroup = this.groups.has(path);
		if (hasGroup && isCommand)
			throw `A group already exists with the same name as this command: ${path}`;

		if (hasGroup) throw `Duplicate group: ${path}`;
	}
}
