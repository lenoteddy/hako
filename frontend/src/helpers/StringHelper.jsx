// Tokens in your Sepolia wallet. Add more here as needed.
export const TOKENS = [
	{ address: "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e", symbol: "USDC", decimals: 6 },
	{ address: "0x278053acc97888e63ec81c80fec641bf0bf19664", symbol: "DAI", decimals: 18 },
];

export const INTERVALS = [
	{ seconds: 60, label: "Every minute" },
	{ seconds: 3600, label: "Every hour" },
	{ seconds: 86400, label: "Every day" },
	{ seconds: 604800, label: "Every week" },
];

export function tokenSymbol(address) {
	return TOKENS.find((t) => t.address.toLowerCase() === address?.toLowerCase())?.symbol ?? shortAddress(address);
}

export function shortAddress(address) {
	if (!address) return "";
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function intervalLabel(seconds) {
	const n = Number(seconds);
	const known = INTERVALS.find((i) => i.seconds === n);
	if (known) return known.label.toLowerCase();
	if (!n) return "—";
	return `every ${n} seconds`;
}
