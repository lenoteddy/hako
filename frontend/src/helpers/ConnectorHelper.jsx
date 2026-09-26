import { createPublicClient, createWalletClient, http, custom } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com"), batch: { multicall: true } });
const wallet = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });
const Connector = { client, wallet };

export default Connector;
