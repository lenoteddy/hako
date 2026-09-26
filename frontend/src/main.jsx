import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";

const queryClient = new QueryClient();
const config = getDefaultConfig({
	appName: "Hako - 箱",
	projectId: "YOUR_REOWN_PROJECT_ID", // free at cloud.reown.com
	chains: [sepolia],
});

createRoot(document.getElementById("root")).render(
	<StrictMode>
		<WagmiConfig config={config}>
			<QueryClientProvider client={queryClient}>
				<RainbowKitProvider>
					<App />
				</RainbowKitProvider>
			</QueryClientProvider>
		</WagmiConfig>
	</StrictMode>,
);
