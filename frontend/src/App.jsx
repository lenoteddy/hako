import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Connector from "./helpers/ConnectorHelper";
import ENS from "./helpers/ENSHelper";
import ClaimName from "./components/ClaimName";
import Dashboard from "./components/Dashboard";
import { PARENT } from "./constants/config";

export default function App() {
	const { address, isConnected } = useAccount();
	const [ensAvatar, setEnsAvatar] = useState("");
	const [account, setAccount] = useState(null);
	const [user, setUser] = useState(null);
	const [phase, setPhase] = useState("disconnected"); // disconnected | loading | claim | ready
	const [error, setError] = useState("");

	const loadUser = useCallback(async (address) => {
		setPhase("loading");
		setError("");
		try {
			const found = await ENS.getUserName(address);
			setUser(found);
			setPhase(found?.setupComplete ? "ready" : "claim");
		} catch (e) {
			setError(e.shortMessage || e.message);
			setPhase("claim");
		}
	}, []);

	const clearUser = useCallback(() => {
		setUser(null);
		setPhase("disconnected");
	}, []);

	async function connect() {
		setError("");
		try {
			const [address] = await Connector.wallet.requestAddresses();
			try {
				await Connector.wallet.switchChain({ id: sepolia.id });
			} catch {
				// wallet may already be on Sepolia or not support switching
			}
			setAccount(address);
			loadUser(address);
		} catch (e) {
			setError(e.shortMessage || e.message);
		}
	}

	useEffect(() => {
		if (!window.ethereum?.on) return;
		const onAccountsChanged = (accounts) => {
			if (!accounts.length) {
				setAccount(null);
				clearUser();
				return;
			}
			setAccount(accounts[0]);
			loadUser(accounts[0]);
		};
		window.ethereum.on("accountsChanged", onAccountsChanged);
		return () => window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
	}, [loadUser, clearUser]);

	useEffect(() => {
		if (isConnected && address) {
			const loadAndSetUser = async () => {
				await loadUser(address);
			};
			loadAndSetUser();
		}
	}, [isConnected, address, loadUser, clearUser]);

	useEffect(() => {
		const initData = async () => {
			const avatar = await Connector.client.getEnsAvatar({ name: normalize(PARENT) });
			setEnsAvatar(avatar);
		};
		initData();
	}, []);

	return (
		<div className="app">
			<header className="flex items-center justify-between">
				<div>{ensAvatar ? <img src={ensAvatar} className="w-30" alt="ENS Avatar" /> : "..."}</div>
				<div className="mx-6">
					<ConnectButton />
				</div>
			</header>
			<main className="main">
				{phase === "disconnected" && (
					<section className="intro">
						<h1>Every automation gets its own name.</h1>
						<p>
							Hako gives you an ENS name, then keeps each recurring payment in its own box underneath it, like <strong>rent.you.{PARENT}</strong>. Anyone can read what it does. Only you
							can change it or shut it down.
						</p>
						<button className="btn btn-primary" onClick={connect}>
							Connect wallet
						</button>
					</section>
				)}
				{phase === "loading" && <p className="muted">Looking up your Hako name…</p>}
				{phase === "claim" && <ClaimName account={account} existing={user} onDone={() => loadUser(account)} />}
				{phase === "ready" && user && address && <Dashboard user={user} account={address} />}
				{error && (
					<p className="error" role="alert">
						{error}
					</p>
				)}
			</main>
		</div>
	);
}
