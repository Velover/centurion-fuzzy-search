import "./config";

import { useEventListener } from "@rbxts/pretty-react-hooks";
import { useSelector } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import Roact, { StrictMode, useContext, useMemo } from "@rbxts/roact";
import { Players, UserInputService } from "@rbxts/services";
import { InterfaceContext } from "../../types";
import { Layer } from "../components/interface/Layer";
import Terminal from "../components/terminal/Terminal";
import { DEFAULT_INTERFACE_OPTIONS } from "../constants/options";
import { OptionsContext } from "../providers/optionsProvider";
import { RootProvider } from "../providers/rootProvider";
import { store } from "../store";
import { selectVisible } from "../store/app";
import { InterfaceOptions } from "../types";

function TerminalApp() {
	const options = useContext(OptionsContext);
	const visible = useSelector(selectVisible);

	const validKeys = useMemo(() => {
		return new Set(options.activationKeys);
	}, [options]);

	useEventListener(UserInputService.InputBegan, (input, gameProcessed) => {
		if (gameProcessed || !validKeys.has(input.KeyCode)) return;
		store.setVisible(!visible);
	});

	return (
		<Layer key="terminal" displayOrder={options.displayOrder} visible={visible}>
			<Terminal key="terminal-layer" />
		</Layer>
	);
}

export const CommanderInterface =
	(options: Partial<InterfaceOptions> = {}) =>
	(context: InterfaceContext) => {
		const root = createRoot(new Instance("Folder"));
		const target = Players.LocalPlayer.WaitForChild("PlayerGui");

		root.render(
			createPortal(
				<StrictMode>
					<RootProvider
						key="root-provider"
						context={context}
						options={{ ...DEFAULT_INTERFACE_OPTIONS, ...options }}
					>
						<TerminalApp key="terminal" />
					</RootProvider>
				</StrictMode>,
				target,
			),
		);
	};
