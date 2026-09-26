import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, decodeErrorResult, erc20Abi, parseAbi } from "viem";
import Connector from "./ConnectorHelper";
import { TASK_EXECUTOR } from "../constants/config";
import { executorAbi } from "../constants/abi";

// Every error the app can hit, so we can decode it no matter which ABI made the call
const KNOWN_ERRORS = parseAbi([
	"error UserNotFound(string userLabel)",
	"error TaskNotFound(string taskLabel)",
	"error NotUsersTask()",
	"error TaskNotActive()",
	"error TooEarly(uint256 nextRunAt)",
	"error BadRecord(string key)",
	"error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
	"error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
	"error SafeERC20FailedOperation(address token)",
	"error NameNotAvailable(string label)",
]);

function timeUntil(unixSeconds) {
	const secs = Number(unixSeconds) - Math.floor(Date.now() / 1000);
	if (secs <= 0) return "a few seconds";
	if (secs < 60) return `${secs} seconds`;
	if (secs < 3600) return `${Math.ceil(secs / 60)} minutes`;
	return `${Math.ceil(secs / 3600)} hours`;
}

function friendly(errorName, args = []) {
	const MESSAGES = {
		TooEarly: ([next]) => `Not due yet. It can run again in ${timeUntil(next)}.`,
		TaskNotActive: () => "This task is paused. Resume it to run it.",
		TaskNotFound: ([label]) => `The task "${label}" no longer exists, so it can't run.`,
		UserNotFound: ([label]) => `No Hako account found for "${label}".`,
		NotUsersTask: () => "This task belongs to a different wallet, so it can't spend your tokens.",
		BadRecord: ([key]) => `This task's settings are incomplete (${key.replace("task.", "")}). Try recreating it.`,
		ERC20InsufficientAllowance: () => "Hako isn't allowed to send this token yet. Click Allow first.",
		ERC20InsufficientBalance: () => "Your wallet doesn't have enough tokens for this payment.",
		SafeERC20FailedOperation: () => "The token transfer failed. Check the task's token.",
		NameNotAvailable: ([label]) => `"${label}" is already taken.`,
	};

	return MESSAGES[errorName] ? MESSAGES[errorName](args) : null;
}

export function readError(e) {
	console.error("Hako error:", e);
	if (!(e instanceof BaseError)) return e?.message || "Something went wrong.";

	// User pressed "Reject" in their wallet
	if (e.walk((err) => err instanceof UserRejectedRequestError)) {
		return "You cancelled the request in your wallet.";
	}

	const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
	if (revert instanceof ContractFunctionRevertedError) {
		// 1. viem already decoded it
		const decoded = revert.data?.errorName && friendly(revert.data.errorName, revert.data.args);
		if (decoded) return decoded;

		// 2. Decode the raw revert data ourselves
		if (revert.raw) {
			try {
				const { errorName, args } = decodeErrorResult({ abi: KNOWN_ERRORS, data: revert.raw });
				const msg = friendly(errorName, args);
				if (msg) return msg;
			} catch {
				// not one of ours
			}
		}

		// 3. Plain-text reason from require("...")
		if (revert.reason) return revert.reason;
	}

	// Common wallet and network problems
	const text = `${e.shortMessage} ${e.details ?? ""}`.toLowerCase();
	if (text.includes("insufficient funds")) return "Not enough Sepolia ETH to pay for gas.";
	if (text.includes("chain") && text.includes("mismatch")) return "Please switch your wallet to Sepolia.";

	return e.shortMessage || "Something went wrong. Please try again.";
}

async function getAccount() {
	const [account] = await Connector.wallet.requestAddresses();
	return account;
}

async function send(request) {
	const { wallet, client } = Connector;
	const hash = await wallet.writeContract(request);
	return client.waitForTransactionReceipt({ hash });
}

// One-time per token: let the executor move the user's tokens
export async function approveExecutor(token, amount) {
	const account = await getAccount();
	await send({ account, address: token, abi: erc20Abi, functionName: "approve", args: [TASK_EXECUTOR, amount] });
}

export async function getAllowance(token, owner) {
	return Connector.client.readContract({
		address: token,
		abi: erc20Abi,
		functionName: "allowance",
		args: [owner, TASK_EXECUTOR],
	});
}

export async function runTask(user, taskLabel) {
	const account = await getAccount();
	const { request } = await Connector.client.simulateContract({
		account,
		address: TASK_EXECUTOR,
		abi: executorAbi,
		functionName: "execute",
		args: [user.label, taskLabel],
	});
	return send(request);
}

export async function getLastRun(user, taskLabel) {
	const { client } = Connector;
	const key = await client.readContract({
		address: TASK_EXECUTOR,
		abi: executorAbi,
		functionName: "taskKey",
		args: [user.label, taskLabel],
	});
	return client.readContract({ address: TASK_EXECUTOR, abi: executorAbi, functionName: "lastRun", args: [key] });
}
