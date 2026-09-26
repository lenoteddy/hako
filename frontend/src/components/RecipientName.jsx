import { useEffect, useState } from "react";
import Connector from "../helpers/ConnectorHelper";
import { shortAddress } from "../helpers/StringHelper";

// Shows the address's ENS primary name (e.g. bob.eth) if it has one, otherwise 0x12…abcd.
export default function RecipientName({ address }) {
	const [name, setName] = useState(null);

	useEffect(() => {
		let cancelled = false;
		if (!address) return;
		Connector.client
			.getEnsName({ address })
			.then((n) => !cancelled && setName(n))
			.catch(() => !cancelled && setName(null));
		return () => {
			cancelled = true;
		};
	}, [address]);

	return <span title={address}>{name ?? shortAddress(address)}</span>;
}
