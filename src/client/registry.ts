import { RunService } from "@rbxts/services";
import { copyDeep } from "@rbxts/sift/out/Dictionary";
import { CommandOptions, GroupOptions, ImmutableCommandPath } from "../shared";
import { CommandGroup } from "../shared/core/command";
import { BaseRegistry } from "../shared/core/registry";
import { remotes } from "../shared/network";
import { ServerCommand } from "./command";

export class ClientRegistry extends BaseRegistry {
	async sync() {
		let firstDispatch = false;
		remotes.sync.dispatch.connect((data) => {
			if (!firstDispatch) {
				firstDispatch = true;
			}

			this.registerServerGroups(data.groups);
			this.registerServerCommands(data.commands);
		});
		remotes.sync.start.fire();

		return new Promise((resolve) => {
			// Wait until dispatch has been received
			while (!firstDispatch) {
				RunService.Heartbeat.Wait();
			}
			resolve(undefined);
		})
			.timeout(5)
			.catch(() => {
				throw "Server did not respond in time";
			});
	}

	getCommandOptions() {
		const commandMap = new Map<string, CommandOptions>();
		for (const [k, v] of this.commands) {
			commandMap.set(k, copyDeep(v.options as CommandOptions));
		}
		return commandMap;
	}

	getGroupOptions() {
		const groupMap = new Map<string, GroupOptions>();
		for (const [k, v] of this.commands) {
			groupMap.set(k, copyDeep(v.options as CommandOptions));
		}
		return groupMap;
	}

	private registerServerGroups(sharedGroups: GroupOptions[]) {
		const childMap = new Map<string, GroupOptions[]>();
		for (const group of sharedGroups) {
			if (group.root !== undefined) {
				const childArray = childMap.get(group.root) ?? [];
				childArray.push(group);
				childMap.set(group.root, childArray);
				continue;
			}

			if (this.groups.has(group.name)) {
				warn("Skipping duplicate server group:", group.name);
				continue;
			}

			this.validatePath(group.name, false);
			this.groups.set(group.name, this.createGroup(group));
		}

		for (const [root, children] of childMap) {
			const rootGroup = this.groups.get(root);
			assert(rootGroup !== undefined, `Parent group '${root}' does not exist`);

			for (const child of children) {
				if (rootGroup.hasGroup(child.name)) {
					warn(`Skipping duplicate server group in ${root}: ${child}`);
					continue;
				}
				rootGroup.addGroup(this.createGroup(child));
			}
		}
	}

	private registerServerCommands(commands: Map<string, CommandOptions>) {
		for (const [path, command] of commands) {
			const commandPath = ImmutableCommandPath.fromString(path);
			let group: CommandGroup | undefined;
			if (commandPath.getSize() > 1) {
				const groupPath = commandPath.remove(commandPath.getSize() - 1);
				group = this.getGroup(groupPath);
				assert(
					group !== undefined,
					`Group '${groupPath}' for server command '${commandPath}' is not registered`,
				);
			}

			if (this.commands.has(path)) {
				// TODO Implement shared command support:
				// - Verify that the argument options are the same
				// - Use the client command's return value to determine whether the
				//   server command should be executed
				// - Maybe log a warning if the description is different on the client
				warn(`Skipping shared command ${commandPath}`);
				continue;
			}

			this.validatePath(path, true);
			this.cachePath(commandPath);
			this.commands.set(path, ServerCommand.create(this, commandPath, command));
		}
	}
}
