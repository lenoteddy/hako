import { useCallback, useState, useEffect } from "react";
import ENS from "../helpers/ENSHelper";
import { intervalLabel, shortAddress, tokenSymbol } from "../helpers/StringHelper";
import { formatUnits } from "viem";
import { TOKENS } from "../helpers/StringHelper";
import { approveExecutor, getAllowance, readError, runTask } from "../helpers/ExecutorHelper";
import TaskForm from "./TaskForm";

const tokenDecimals = (address) => TOKENS.find((t) => t.address.toLowerCase() === address?.toLowerCase())?.decimals ?? 18;

export default function Dashboard({ user, account }) {
	const [tasks, setTasks] = useState([]);
	const [loading, setLoading] = useState(true);
	const [showForm, setShowForm] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [busyTask, setBusyTask] = useState(null);
	const [allowances, setAllowances] = useState({});
	const { label, name, registry } = user;

	// Runs an action for one task, then reloads
	async function act(taskLabel, fn, successMessage) {
		setBusyTask(taskLabel);
		setError("");
		setNotice("");
		try {
			await fn();
			if (successMessage) setNotice(successMessage);
			await refresh();
		} catch (e) {
			setError(readError(e));
			// setError(e.shortMessage || e.message);
		} finally {
			setBusyTask(null);
		}
	}

	const refresh = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const withRuns = await ENS.listTasks({ label, name, registry });
			setTasks(withRuns);

			const tokens = [...new Set(withRuns.map((t) => t.token?.toLowerCase()).filter(Boolean))];
			const entries = await Promise.all(tokens.map(async (tk) => [tk, await getAllowance(tk, account)]));
			setAllowances(Object.fromEntries(entries));
		} catch (e) {
			setError(readError(e));
		} finally {
			setLoading(false);
		}
	}, [label, name, registry, account]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError("");
			try {
				const withRuns = await ENS.listTasks({ label, name, registry });
				if (!cancelled) {
					setTasks(withRuns);
					const tokens = [...new Set(withRuns.map((t) => t.token?.toLowerCase()).filter(Boolean))];
					const entries = await Promise.all(tokens.map(async (tk) => [tk, await getAllowance(tk, account)]));
					setAllowances(Object.fromEntries(entries));
				}
			} catch (e) {
				if (!cancelled) setError(readError(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [account, label, name, registry]);

	return (
		<section className="dashboard">
			<div className="dashboard-head">
				<div>
					<h1 className="owner-name">{user.name}</h1>
					<p className="muted">{loading ? "Loading your tasks…" : tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}</p>
				</div>
				{!showForm && (
					<button className="btn btn-primary" onClick={() => setShowForm(true)}>
						New task
					</button>
				)}
			</div>

			{showForm && (
				<TaskForm
					user={user}
					onCancel={() => setShowForm(false)}
					onCreated={() => {
						setShowForm(false);
						refresh();
					}}
				/>
			)}

			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}

			{notice && (
				<p className="ok" role="status">
					{notice}
				</p>
			)}

			{!loading && tasks.length === 0 && !showForm && (
				<div className="empty">
					<p>No tasks yet. Create one and it gets its own name under {user.name}.</p>
				</div>
			)}

			<ul className="shelf">
				{tasks.map((task) => {
					const busy = busyTask === task.label;
					const active = task.status === "active";
					const decimals = tokenDecimals(task.token);
					const amount = BigInt(task.amount || "0");
					const allowance = BigInt(allowances[task.token?.toLowerCase()] ?? 0n);
					const needsApproval = active && allowance < amount;
					const nextRun = task.lastRun ? task.lastRun + task.interval : 0;
					const isDue = active && (!task.lastRun || new Date().getTime() / 1000 >= nextRun);

					return (
						<li key={task.name} className="box">
							<div className={`${task.status !== "active" ? "box-paused" : ""}`}>
								<div className="box-tape">{task.name}</div>
								<div className="box-body">
									<p className="box-amount">
										{formatUnits(BigInt(task.amount || "0"), TOKENS.find((t) => t.address.toLowerCase() === task.token?.toLowerCase())?.decimals ?? 18)} {tokenSymbol(task.token)}
									</p>
									<p>
										to {shortAddress(task.recipient)}, {intervalLabel(task.interval)}
									</p>
									{needsApproval && (
										<p className="error small">
											Hako can't send this yet.{" "}
											<button
												className="link-btn"
												disabled={busy}
												onClick={() => act(task.label, () => approveExecutor(task.token, amount * 100n), `Hako can now send ${tokenSymbol(task.token)} for your tasks.`)}
											>
												Allow {tokenSymbol(task.token)}
											</button>
										</p>
									)}
								</div>
								<div className="box-foot">
									<span className={`status status-${task.status || "unknown"}`}>{task.status === "active" ? "Active" : task.status || "Unknown"}</span>
									<span className="muted small">{task.type}</span>
								</div>
							</div>
							<div className="box-actions p-4">
								{active && !needsApproval && (
									<button
										className="link-btn execute"
										disabled={busy || !isDue}
										title={isDue ? "Send this payment now" : "Not due yet"}
										onClick={() => act(task.label, () => runTask(user, task.label), `Sent ${formatUnits(amount, decimals)} ${tokenSymbol(task.token)}.`)}
									>
										Run now
									</button>
								)}
								<button
									className="link-btn"
									disabled={busy}
									onClick={() => act(task.label, () => ENS.setTaskStatus(user, task.label, active ? "paused" : "active"), active ? "Task paused." : "Task resumed.")}
								>
									{active ? "Pause" : "Resume"}
								</button>
								<button
									className="link-btn link-danger"
									disabled={busy}
									onClick={() => {
										if (confirm(`Delete ${task.name}? It can't run again after this.`)) {
											act(task.label, () => ENS.deleteTask(user, task.label), `${task.name} deleted.`);
										}
									}}
								>
									Delete
								</button>
							</div>
						</li>
					);
				})}
			</ul>

			{!loading && tasks.length > 0 && (
				<button className="btn btn-quiet" onClick={refresh}>
					Refresh
				</button>
			)}
		</section>
	);
}
