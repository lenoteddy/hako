import { useState, useEffect } from "react";
import { isAddress } from "viem";
import { normalize } from "viem/ens";
import Connector from "../helpers/ConnectorHelper";
import ENS, { toLabel } from "../helpers/ENSHelper";
import { INTERVALS, shortAddress, TOKENS } from "../helpers/StringHelper";

// Turns "0x…" or "bob.eth" into an address. The address is what gets stored,
// so later changes to where the name points can't redirect this task's payments.
async function resolveRecipient(input) {
	const value = input.trim();
	if (isAddress(value)) return value;
	if (!value.includes(".")) throw new Error("Enter a 0x address or an ENS name like bob.eth");
	let name;
	try {
		name = normalize(value);
	} catch {
		throw new Error(`${value} isn't a valid ENS name`);
	}
	const address = await Connector.client.getEnsAddress({ name });
	if (!address) throw new Error(`${value} doesn't point to an address`);
	return address;
}

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

	// Only finished lookups are stored, tagged with the value they were for
	const [lookup, setLookup] = useState({ value: "", address: null, name: null, message: "" });

	const recipientValue = form.recipient.trim();
	const isHexAddress = isAddress(recipientValue);
	const isEnsName = recipientValue !== "" && !isHexAddress && recipientValue.includes(".");
	const needsLookup = isHexAddress || isEnsName;

	// Derived during render
	const recipientState = !needsLookup
		? { status: "idle" }
		: lookup.value !== recipientValue
			? { status: "resolving" }
			: isHexAddress
				? { status: "reverse", name: lookup.name } // name may be null (no primary name)
				: lookup.address
					? { status: "resolved", address: lookup.address }
					: { status: "error", message: lookup.message };

	useEffect(() => {
		if (!needsLookup) return;
		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				if (isHexAddress) {
					// 0x… → primary name
					const name = await Connector.client.getEnsName({ address: recipientValue }).catch(() => null);
					if (!cancelled) setLookup({ value: recipientValue, address: recipientValue, name, message: "" });
				} else {
					// name.eth → 0x…
					const address = await resolveRecipient(recipientValue);
					if (!cancelled) setLookup({ value: recipientValue, address, name: null, message: "" });
				}
			} catch (e) {
				if (!cancelled) setLookup({ value: recipientValue, address: null, name: null, message: e.message });
			}
		}, 500);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [recipientValue, isHexAddress, needsLookup]);

	let preview = "";
	try {
		preview = form.label ? `${toLabel(form.label)}.${user.name}` : "";
	} catch {
		// ignore error, keep preview empty
	}

	async function submit(e) {
		e.preventDefault();
		setError("");

		let recipient;
		try {
			toLabel(form.label); // throws a readable message
			if (!(Number(form.amount) > 0)) throw new Error("Enter an amount greater than 0");
			recipient = await resolveRecipient(form.recipient); // accepts 0x… or name.eth
		} catch (err) {
			setError(err.message);
			return;
		}
		console.log("Resolved recipient:", recipient);

		setBusy(true);
		try {
			await ENS.createTask(
				user,
				{
					label: form.label,
					type: "transfer",
					token: form.token,
					decimals: TOKENS.find((t) => t.address === form.token).decimals,
					amount: form.amount,
					recipient, // the resolved address, not form.recipient
					interval: form.interval,
					expiresInDays: Number(form.expiresInDays),
				},
				setStep,
			);
			onCreated();
		} catch (err) {
			setError(err.message);
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
				<input value={form.recipient} onChange={update("recipient")} placeholder="0x… or name.eth" disabled={busy} spellCheck={false} autoCapitalize="off" />
				{recipientState.status === "resolving" && <small className="muted">Looking up…</small>}
				{recipientState.status === "resolved" && (
					<small className="ok" title={recipientState.address}>
						Resolves to {shortAddress(recipientState.address)}. This address is saved with the task.
					</small>
				)}
				{recipientState.status === "reverse" && recipientState.name && <small className="ok">This address is {recipientState.name}.</small>}
				{recipientState.status === "error" && <small className="error">{recipientState.message}</small>}
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
				<p className="error" role="alert" style={{ maxWidth: "100%", overflowWrap: "break-word" }}>
					{error}
				</p>
			)}
		</form>
	);
}
