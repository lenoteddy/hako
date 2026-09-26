import { useState } from "react";
import ENS, { isNicknameAvailable, toLabel } from "../helpers/ENSHelper";
import { PARENT } from "../constants/config";

export default function ClaimName({ existing, onDone }) {
	// If the wallet registered a name but setup didn't finish, resume with that name
	const resuming = Boolean(existing && !existing.setupComplete);
	const [input, setInput] = useState(resuming ? existing.label : "");
	const [availability, setAvailability] = useState(resuming ? "yours" : null); // null | checking | available | taken | yours
	const [step, setStep] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	let preview = "";
	try {
		preview = input ? `${toLabel(input)}.${PARENT}` : "";
	} catch {
		// ignore error, keep preview empty
	}

	async function check() {
		setError("");
		setAvailability("checking");
		try {
			setAvailability((await isNicknameAvailable(input)) ? "available" : "taken");
		} catch (e) {
			setError(e.message);
			setAvailability(null);
		}
	}

	async function claim() {
		setError("");
		setBusy(true);
		try {
			await ENS.signUp(input, setStep);
			onDone();
		} catch (e) {
			setError(e.shortMessage || e.message);
			setStep("");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="panel claim">
			<h1>{resuming ? "Finish setting up your name" : "Claim your Hako name"}</h1>
			<p className="muted">
				{resuming ? "Your name is registered. A couple of steps are left before you can add tasks." : "This becomes the home for your tasks. You own it and all your tasks under it."}
			</p>
			<label className="field">
				<span>Nickname</span>
				<div className="name-input">
					<input
						value={input}
						disabled={resuming || busy}
						onChange={(e) => {
							setInput(e.target.value);
							setAvailability(null);
						}}
						onKeyDown={(e) => e.key === "Enter" && input && !availability && check()}
						placeholder="jack"
						autoComplete="off"
						spellCheck={false}
					/>
					<span className="suffix">.{PARENT}</span>
				</div>
			</label>
			{availability === "taken" && <p className="error">{preview} is taken. Try another nickname.</p>}
			{(availability === null || availability === "checking" || availability === "taken") && (
				<button className="btn btn-primary" onClick={check} disabled={!input || availability === "checking"}>
					{availability === "checking" ? "Checking…" : "Check availability"}
				</button>
			)}
			{(availability === "available" || availability === "yours") && (
				<>
					{availability === "available" && <p className="ok">{preview} is available.</p>}
					<button className="btn btn-primary" onClick={claim} disabled={busy}>
						{busy ? "Working…" : resuming ? "Finish setup" : `Claim ${preview}`}
					</button>
					<p className="muted small">Your wallet will ask you to confirm a few transactions.</p>
				</>
			)}
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
		</section>
	);
}
