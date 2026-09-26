import { useState } from "react";
import { isAddress } from "viem";
import ENS, { toLabel } from "../helpers/ENSHelper";
import { INTERVALS, TOKENS } from "../helpers/StringHelper";

export default function TaskForm({ user, onCreated, onCancel }) {
	const [form, setForm] = useState({
		label: "",
		token: TOKENS[0].address,
		amount: "",
		recipient: "",
		interval: String(INTERVALS[0].seconds),
		expiresInDays: "30",
	});
	const [step, setStep] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

	let preview = "";
	try {
		preview = form.label ? `${toLabel(form.label)}.${user.name}` : "";
	} catch {
		// ignore error, keep preview empty
	}

	function validate() {
		toLabel(form.label); // throws a readable message
		if (!(Number(form.amount) > 0)) throw new Error("Enter an amount greater than 0");
		if (!isAddress(form.recipient)) throw new Error("Enter a valid recipient address (0x…)");
	}

	async function submit(e) {
		e.preventDefault();
		setError("");
		try {
			validate();
		} catch (err) {
			setError(err.message);
			return;
		}

		setBusy(true);
		try {
			await ENS.createTask(
				user,
				{
					label: form.label,
					type: "transfer",
					token: form.token,
					amount: form.amount,
					recipient: form.recipient,
					interval: form.interval,
					expiresInDays: Number(form.expiresInDays),
					decimals: TOKENS.find((t) => t.address === form.token).decimals,
				},
				setStep,
			);
			onCreated();
		} catch (err) {
			setError(err.shortMessage || err.message);
			setStep("");
		} finally {
			setBusy(false);
		}
	}

	return (
		<form className="panel task-form" onSubmit={submit}>
			<h2>New recurring transfer</h2>

			<label className="field">
				<span>Task name</span>
				<input value={form.label} onChange={update("label")} placeholder="rent" disabled={busy} spellCheck={false} />
				{preview && <small className="muted">Will be created as {preview}</small>}
			</label>

			<div className="field-row">
				<label className="field">
					<span>Amount</span>
					<input value={form.amount} onChange={update("amount")} placeholder="10" inputMode="decimal" disabled={busy} />
				</label>
				<label className="field">
					<span>Token</span>
					<select value={form.token} onChange={update("token")} disabled={busy}>
						{TOKENS.map((t) => (
							<option key={t.address} value={t.address}>
								{t.symbol}
							</option>
						))}
					</select>
				</label>
			</div>

			<label className="field">
				<span>Send to</span>
				<input value={form.recipient} onChange={update("recipient")} placeholder="0x…" disabled={busy} spellCheck={false} />
			</label>

			<div className="field-row">
				<label className="field">
					<span>How often</span>
					<select value={form.interval} onChange={update("interval")} disabled={busy}>
						{INTERVALS.map((i) => (
							<option key={i.seconds} value={i.seconds}>
								{i.label}
							</option>
						))}
					</select>
				</label>
				<label className="field">
					<span>Stops after</span>
					<select value={form.expiresInDays} onChange={update("expiresInDays")} disabled={busy}>
						<option value="1">1 day</option>
						<option value="7">7 days</option>
						<option value="30">30 days</option>
						<option value="90">90 days</option>
					</select>
				</label>
			</div>

			<p className="muted small">The task's name expires when it stops, so it can't run after that date.</p>

			<div className="actions">
				<button type="submit" className="btn btn-primary" disabled={busy}>
					{busy ? "Creating…" : "Create task"}
				</button>
				<button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
			</div>

			{step && (
				<p className="progress" aria-live="polite">
					{step}
				</p>
			)}
			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}
		</form>
	);
}
