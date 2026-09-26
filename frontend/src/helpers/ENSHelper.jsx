import {
	concat,
	encodeAbiParameters,
	encodeFunctionData,
	erc20Abi,
	getCreate2Address,
	keccak256,
	labelhash,
	namehash,
	parseAbi,
	parseEventLogs,
	parseUnits,
	stringToHex,
	toHex,
	zeroAddress,
} from "viem";
import { normalize } from "viem/ens";
import Connector from "./ConnectorHelper";
import { ETH_REGISTRY, VERIFIABLE_FACTORY, PERMISSIONED_RESOLVER_IMPL, USER_REGISTRY_IMPL, HAKO_REGISTRY, HAKO_REGISTRAR, REGISTRAR_DEPLOY_BLOCK, PARENT, ALL_ROLES } from "../constants/config";
import {
	permissionedRegistryAbi,
	resolverInitAbi,
	registryInitAbi,
	verifiableFactoryAbi,
	registrarAbi,
	nameRegisteredEvent,
	registryAbi,
	factoryAbi,
	textByNodeAbi,
	textByNameAbi,
	setTextByNodeAbi,
	setTextByNameAbi,
	multicallAbi,
	unregisterAbi,
} from "../constants/abi";

async function getAccount() {
	const [account] = await Connector.wallet.requestAddresses();
	return account;
}

async function deployProxy(implementation, salt, initData) {
	const { wallet, client } = Connector;
	const account = await getAccount();
	const hash = await wallet.writeContract({
		account,
		address: VERIFIABLE_FACTORY,
		abi: verifiableFactoryAbi,
		functionName: "deployProxy",
		args: [implementation, salt, initData],
	});
	const receipt = await client.waitForTransactionReceipt({ hash });
	const [log] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
	if (!log) throw new Error("ProxyDeployed event not found");
	return log.args.proxyAddress;
}

// Deploys a Permissioned Resolver owned by the connected wallet
async function deployResolver(version = 0n) {
	const account = await getAccount();
	const salt = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(stringToHex("OwnedResolver")), account, version])));
	const initData = encodeFunctionData({
		abi: resolverInitAbi,
		functionName: "initialize",
		args: [[{ account, roleBitmap: ALL_ROLES }], []],
	});
	return deployProxy(PERMISSIONED_RESOLVER_IMPL, salt, initData);
}

async function deployRegistry(fullName, version = 0n) {
	const account = await getAccount();
	const salt = BigInt(
		keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(stringToHex("UserRegistry")), namehash(normalize(fullName)), version])),
	);
	const initData = encodeFunctionData({
		abi: registryInitAbi,
		functionName: "initialize",
		args: [[{ account, roleBitmap: ALL_ROLES }]],
	});
	return deployProxy(USER_REGISTRY_IMPL, salt, initData);
}

// label: e.g. "hako"; parentRegistry: the registry that holds that label
async function writeToParent(functionName, label, target, parentRegistry) {
	const { wallet, client } = Connector;
	const account = await getAccount();
	const hash = await wallet.writeContract({
		account,
		address: parentRegistry,
		abi: permissionedRegistryAbi,
		functionName,
		args: [BigInt(labelhash(normalize(label))), target],
	});
	await client.waitForTransactionReceipt({ hash });
	return hash;
}

const setResolver = (label, resolverAddress, parentRegistry = ETH_REGISTRY) => writeToParent("setResolver", label, resolverAddress, parentRegistry);
const setSubregistry = (label, registryAddress, parentRegistry = ETH_REGISTRY) => writeToParent("setSubregistry", label, registryAddress, parentRegistry);

async function grantRootRoles(userRegistryAddress, registrarAddress) {
	const ROLE_REGISTRAR = 1n << 0n;
	const ROLE_RENEW = 1n << 16n;

	const { wallet } = Connector;
	const [account] = await wallet.requestAddresses();

	await wallet.writeContract({
		address: userRegistryAddress,
		abi: [
			{
				name: "grantRootRoles",
				type: "function",
				stateMutability: "nonpayable",
				inputs: [
					{ name: "roleBitmap", type: "uint256" },
					{ name: "account", type: "address" },
				],
				outputs: [{ name: "", type: "bool" }],
			},
		],
		functionName: "grantRootRoles",
		args: [ROLE_REGISTRAR | ROLE_RENEW, registrarAddress],
		account,
	});
}

export function toLabel(input) {
	const t = input.trim();
	if (!t) throw new Error("Please enter a nickname");
	if (t.includes(".")) throw new Error("Nicknames can't contain dots");
	try {
		return normalize(t);
	} catch {
		throw new Error("That nickname has characters ENS doesn't allow");
	}
}

async function send(request) {
	const { wallet, client } = Connector;
	const hash = await wallet.writeContract(request);
	return client.waitForTransactionReceipt({ hash });
}

// Predicts a factory proxy address (from the ENS Verifiable Factory docs)
async function predictProxy(deployer, salt) {
	const proxyLogic = await Connector.client.readContract({
		address: VERIFIABLE_FACTORY,
		abi: factoryAbi,
		functionName: "proxyLogic",
	});
	const outerSalt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [deployer, salt]));
	const initCode = concat(["0x3d604d80600a3d3981f3363d3d373d3d3d363d73", proxyLogic, "0x5af43d82803e903d91602b57fd5bf3", outerSalt]);
	return getCreate2Address({ from: VERIFIABLE_FACTORY, salt: outerSalt, bytecodeHash: keccak256(initCode) });
}

// Deploys a proxy, or returns the existing one if already deployed
async function deployOrReuse(account, impl, salt, initData) {
	const predicted = await predictProxy(account, salt);
	const code = await Connector.client.getCode({ address: predicted });
	if (code && code !== "0x") return predicted;

	const receipt = await send({
		account,
		address: VERIFIABLE_FACTORY,
		abi: factoryAbi,
		functionName: "deployProxy",
		args: [impl, salt, initData],
	});
	const [log] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
	return log.args.proxyAddress;
}

const resolverSalt = (owner) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(stringToHex("OwnedResolver")), owner, 0n])));
const registrySalt = (fullName) =>
	BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(stringToHex("UserRegistry")), namehash(fullName), 0n])));

// ---------- lookups ----------
// Finds the Hako name a wallet owns, or null
export async function getUserName(user) {
	const { client } = Connector;
	const logs = await client.getLogs({
		address: HAKO_REGISTRAR,
		event: nameRegisteredEvent,
		fromBlock: REGISTRAR_DEPLOY_BLOCK,
	});
	const mine = logs.filter((l) => l.args.owner.toLowerCase() === user.toLowerCase());

	for (const log of mine.reverse()) {
		const label = log.args.label;
		const owner = await client.readContract({
			address: HAKO_REGISTRY,
			abi: registryAbi,
			functionName: "findOwner",
			args: [label],
		});
		if (owner.toLowerCase() === user.toLowerCase()) {
			const registry = await client.readContract({
				address: HAKO_REGISTRY,
				abi: registryAbi,
				functionName: "getSubregistry",
				args: [label],
			});
			return { label, name: `${label}.${PARENT}`, registry, setupComplete: registry !== zeroAddress };
		}
	}
	return null;
}

export async function isNicknameAvailable(input) {
	return Connector.client.readContract({
		address: HAKO_REGISTRAR,
		abi: registrarAbi,
		functionName: "isAvailable",
		args: [toLabel(input)],
	});
}

// ---------- sign-up (resumable) ----------
export async function signUp(input, onStep = () => {}) {
	const { client } = Connector;
	const label = toLabel(input);
	const fullName = `${label}.${PARENT}`;
	const account = await getAccount();

	// 1. Resolver
	onStep("Setting up your profile…");
	const resolver = await deployOrReuse(
		account,
		PERMISSIONED_RESOLVER_IMPL,
		resolverSalt(account),
		encodeFunctionData({
			abi: parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)"]),
			functionName: "initialize",
			args: [[{ account, roleBitmap: ALL_ROLES }], []],
		}),
	);

	// 2 + 3. Register the name (skip if this wallet already owns it)
	const currentOwner = await client.readContract({
		address: HAKO_REGISTRY,
		abi: registryAbi,
		functionName: "findOwner",
		args: [label],
	});
	if (currentOwner.toLowerCase() !== account.toLowerCase()) {
		if (currentOwner !== zeroAddress) throw new Error("That name is taken");

		const [minDuration, token] = await Promise.all([
			client.readContract({ address: HAKO_REGISTRAR, abi: registrarAbi, functionName: "MIN_DURATION" }),
			client.readContract({ address: HAKO_REGISTRAR, abi: registrarAbi, functionName: "PAYMENT_TOKEN" }),
		]);
		const TEN_YEARS = 10n * 365n * 24n * 60n * 60n;
		const duration = minDuration > TEN_YEARS ? minDuration : TEN_YEARS;
		const price = await client.readContract({
			address: HAKO_REGISTRAR,
			abi: registrarAbi,
			functionName: "getPrice",
			args: [duration],
		});

		if (price > 0n) {
			onStep("Approving payment…");
			await send({ account, address: token, abi: erc20Abi, functionName: "approve", args: [HAKO_REGISTRAR, price] });
		}

		onStep(`Registering ${fullName}…`);
		await send({
			account,
			address: HAKO_REGISTRAR,
			abi: registrarAbi,
			functionName: "register",
			args: [label, account, resolver, duration],
		});
	}

	// 4. Task registry
	onStep("Creating your task space…");
	const registry = await deployOrReuse(
		account,
		USER_REGISTRY_IMPL,
		registrySalt(fullName),
		encodeFunctionData({
			abi: parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants)"]),
			functionName: "initialize",
			args: [[{ account, roleBitmap: ALL_ROLES }]],
		}),
	);

	// 5. Link it (skip if already linked)
	const linked = await client.readContract({
		address: HAKO_REGISTRY,
		abi: registryAbi,
		functionName: "getSubregistry",
		args: [label],
	});
	if (linked.toLowerCase() !== registry.toLowerCase()) {
		onStep("Linking your task space…");
		await send({
			account,
			address: HAKO_REGISTRY,
			abi: registryAbi,
			functionName: "setSubregistry",
			args: [BigInt(keccak256(stringToHex(label))), registry],
		});
	}

	return { label, name: fullName, resolver, registry };
}

// ---------- resolver compatibility ----------
const SELECTORS = {
	setTextNode: "10f13a8c", // setText(bytes32,string,string)
	setTextName: "c7279f88", // setText(bytes,string,string)
	textNode: "59d1d43c", // text(bytes32,string)
	textName: "97c31851", // text(bytes,string)
	multicall: "ac9650d8", // multicall(bytes[])
};

let resolverFeatures;
export async function getResolverFeatures() {
	if (resolverFeatures) return resolverFeatures;
	const code = (await Connector.client.getCode({ address: PERMISSIONED_RESOLVER_IMPL })).toLowerCase();
	resolverFeatures = Object.fromEntries(Object.entries(SELECTORS).map(([k, sel]) => [k, code.includes(sel)]));
	console.log("Resolver features:", resolverFeatures);
	return resolverFeatures;
}

// DNS wire format: each label prefixed by its byte length, ending with 0
function dnsEncode(name) {
	const parts = normalize(name)
		.split(".")
		.map((l) => new TextEncoder().encode(l));
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 1));
	let i = 0;
	for (const p of parts) {
		out[i++] = p.length;
		out.set(p, i);
		i += p.length;
	}
	return toHex(out);
}

async function readText(resolver, name, key) {
	const { client } = Connector;
	const attempts = [
		{ label: "bytes name", abi: textByNameAbi, arg: dnsEncode(name) }, // matches how records were written
		{ label: "bytes32 node", abi: textByNodeAbi, arg: namehash(normalize(name)) },
	];

	for (const { label, abi, arg } of attempts) {
		try {
			const value = await client.readContract({ address: resolver, abi, functionName: "text", args: [arg, key] });
			console.log(`text(${key}) via ${label}:`, JSON.stringify(value));
			if (value) return value;
		} catch (e) {
			console.warn(`text(${key}) via ${label} failed:`, e.shortMessage || e.message);
		}
	}

	// Last resort: let ENS's Universal Resolver find the right call
	try {
		const value = await client.getEnsText({ name: normalize(name), key });
		console.log(`text(${key}) via Universal Resolver:`, JSON.stringify(value));
		return value ?? "";
	} catch (e) {
		console.warn(`text(${key}) via Universal Resolver failed:`, e.shortMessage || e.message);
		return "";
	}
}

async function writeTexts(account, resolver, name, records) {
	const f = await getResolverFeatures();
	const byName = !f.setTextNode;
	const abi = byName ? setTextByNameAbi : setTextByNodeAbi;
	const arg = byName ? dnsEncode(name) : namehash(normalize(name));
	const entries = Object.entries(records);

	if (f.multicall) {
		const calls = entries.map(([key, value]) => encodeFunctionData({ abi, functionName: "setText", args: [arg, key, String(value)] }));
		await send({ account, address: resolver, abi: multicallAbi, functionName: "multicall", args: [calls] });
	} else {
		for (const [key, value] of entries) {
			await send({ account, address: resolver, abi, functionName: "setText", args: [arg, key, String(value)] });
		}
	}
}

// ---------- tasks ----------
const userRegistryAbi = parseAbi([
	"function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
	"function getStatus(uint256 anyId) view returns (uint8)",
]);
const hakoRegistryReadAbi = parseAbi(["function getResolver(string label) view returns (address)"]);

const ROLE_SET_RESOLVER = 1n << 24n;
const TASK_ROLES = ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << 128n);

async function getUserResolver(user) {
	const resolver = await Connector.client.readContract({
		address: HAKO_REGISTRY,
		abi: hakoRegistryReadAbi,
		functionName: "getResolver",
		args: [user.label],
	});
	if (resolver === zeroAddress) throw new Error("Your name has no resolver");
	return resolver;
}

// task: { label, type, token, decimals, amount ("10"), recipient, interval, expiresInDays }
export async function createTask(user, task, onStep = () => {}) {
	const { client } = Connector;
	const account = await getAccount();
	const taskLabel = toLabel(task.label);
	const taskName = `${taskLabel}.${user.name}`;
	const resolver = await getUserResolver(user);

	// 1. Register the task name in the user's own registry
	const status = await client.readContract({
		address: user.registry,
		abi: userRegistryAbi,
		functionName: "getStatus",
		args: [BigInt(labelhash(taskLabel))],
	});
	if (status !== 0) throw new Error(`A task called "${taskLabel}" already exists`);

	const expiry = BigInt(Math.floor(Date.now() / 1000)) + BigInt(task.expiresInDays ?? 30) * 86400n;

	onStep(`Creating ${taskName}…`);
	await send({
		account,
		address: user.registry,
		abi: userRegistryAbi,
		functionName: "register",
		args: [taskLabel, account, zeroAddress, resolver, TASK_ROLES, expiry],
	});

	// 2. Save the task's settings (amount in the token's smallest unit)
	onStep("Saving task settings…");
	await writeTexts(account, resolver, taskName, {
		"task.type": task.type,
		"task.token": task.token,
		"task.amount": parseUnits(String(task.amount), task.decimals).toString(),
		"task.recipient": task.recipient,
		"task.interval": task.interval,
		"task.status": "active",
	});

	// 3. Add it to the user's task list
	onStep("Adding to your task list…");
	const index = await readText(resolver, user.name, "hako.tasks");
	const labels = new Set(index.split(",").filter(Boolean));
	labels.add(taskLabel);
	await writeTexts(account, resolver, user.name, { "hako.tasks": [...labels].join(",") });

	return { name: taskName, expiry };
}

export async function listTasks(user) {
	const resolver = await getUserResolver(user);
	const index = await readText(resolver, user.name, "hako.tasks");
	console.log(index);
	const keys = ["type", "token", "amount", "recipient", "interval", "status"];

	return Promise.all(
		index
			.split(",")
			.filter(Boolean)
			.map(async (label) => {
				const name = `${label}.${user.name}`;
				const values = await Promise.all(keys.map((k) => readText(resolver, name, `task.${k}`)));
				return { label, name, ...Object.fromEntries(keys.map((k, i) => [k, values[i]])) };
			}),
	);
}

export async function setTaskStatus(user, taskLabel, status) {
	const account = await getAccount();
	const resolver = await getUserResolver(user);
	await writeTexts(account, resolver, `${taskLabel}.${user.name}`, { "task.status": status });
}

export async function deleteTask(user, taskLabel, onStep = () => {}) {
	const account = await getAccount();
	const resolver = await getUserResolver(user);

	// 1. Remove the name from ENS; Alice holds ROLE_UNREGISTER on her own registry
	onStep(`Deleting ${taskLabel}.${user.name}…`);
	await send({
		account,
		address: user.registry,
		abi: unregisterAbi,
		functionName: "unregister",
		args: [BigInt(labelhash(normalize(taskLabel)))],
	});

	// 2. Remove it from the task list
	onStep("Updating your task list…");
	const index = await readText(resolver, user.name, "hako.tasks");
	const remaining = index.split(",").filter((l) => l && l !== taskLabel);
	await writeTexts(account, resolver, user.name, { "hako.tasks": remaining.join(",") });
}

export default { ETH_REGISTRY, deployResolver, deployRegistry, setResolver, setSubregistry, grantRootRoles, getUserName, signUp, createTask, listTasks, setTaskStatus, deleteTask };
