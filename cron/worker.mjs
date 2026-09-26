// Hako cron worker: every minute, find tasks in ENS and trigger the ones that are due.
// The bot has no special permissions. TaskExecutor checks ENS and only pays when the name allows it.

// Run:  PRIVATE_KEY=0x... node worker.mjs
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, decodeErrorResult, BaseError, ContractFunctionRevertedError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 60_000;
const HAKO_REGISTRAR = process.env.HAKO_REGISTRAR || "0x8ad6d2981f60b804eaca6d98852025cc941bbd31";
const REGISTRAR_DEPLOY_BLOCK = process.env.REGISTRAR_DEPLOY_BLOCK ? BigInt(process.env.REGISTRAR_DEPLOY_BLOCK) : 11781722n;
const TASK_EXECUTOR = process.env.TASK_EXECUTOR || "0x3Ec3a5c062583a185F301855eBe1E2f6A8F80EDf";
const PARENT = process.env.PARENT || "hako-箱.eth";

const executorAbi = parseAbi([
	"function execute(string userLabel, string taskLabel)",
	"error UserNotFound(string userLabel)",
	"error TaskNotFound(string taskLabel)",
	"error NotUsersTask()",
	"error TaskNotActive()",
	"error TooEarly(uint256 nextRunAt)",
	"error BadRecord(string key)",
	"error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
	"error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
	"error SafeERC20FailedOperation(address token)",
]);
const nameRegistered = parseAbiItem("event NameRegistered(uint256 indexed tokenId, string label, address owner, uint64 duration, uint256 price)");

// Expected skips: not worth logging every minute
const QUIET = new Set(["TooEarly", "TaskNotActive", "TaskNotFound"]);

const client = createPublicClient({ chain: sepolia, transport: http(RPC_URL), batch: { multicall: true } });
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

function errorName(e) {
	if (!(e instanceof BaseError)) return e?.message;
	const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
	if (revert?.data?.errorName) return revert.data.errorName;
	if (revert?.raw) {
		try {
			return decodeErrorResult({ abi: executorAbi, data: revert.raw }).errorName;
		} catch {}
	}
	return e.shortMessage;
}

async function getUsers() {
	const logs = await client.getLogs({ address: HAKO_REGISTRAR, event: nameRegistered, fromBlock: REGISTRAR_DEPLOY_BLOCK });
	return [...new Set(logs.map((l) => l.args.label))];
}

async function getTaskLabels(userLabel) {
	try {
		const index = await client.getEnsText({ name: normalize(`${userLabel}.${PARENT}`), key: "hako.tasks" });
		return (index || "").split(",").filter(Boolean);
	} catch {
		return [];
	}
}

async function tick() {
	const started = new Date().toLocaleTimeString();
	const users = await getUsers();
	let ran = 0;

	for (const user of users) {
		for (const task of await getTaskLabels(user)) {
			const name = `${task}.${user}.${PARENT}`;
			try {
				// Free dry run: fails for paused, deleted or not-yet-due tasks
				const { request } = await client.simulateContract({
					account,
					address: TASK_EXECUTOR,
					abi: executorAbi,
					functionName: "execute",
					args: [user, task],
				});
				const hash = await wallet.writeContract(request);
				await client.waitForTransactionReceipt({ hash });
				console.log(`✅ ${name} ran: https://sepolia.etherscan.io/tx/${hash}`);
				ran++;
			} catch (e) {
				const reason = errorName(e);
				if (!QUIET.has(reason)) console.log(`⚠️  ${name} skipped: ${reason}`);
			}
		}
	}
	console.log(`[${started}] checked ${users.length} users, ran ${ran} task(s)`);
}

async function loop() {
	try {
		await tick();
	} catch (e) {
		console.error("Tick failed:", e.shortMessage || e.message);
	}
	setTimeout(loop, INTERVAL_MS);
}

console.log(`Hako worker started as ${account.address}`);
loop();
