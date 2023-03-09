import { useEffect, useState } from "react";

export const ServerDateComponent = () => {
	const [date, setDate] = useState("Loading...");

	useEffect(() => {
		fetch("/date")
			.then((response) => response.text())
			.then((date) => setDate(date));
	});

	return <div>The time, according to the server, is: {date}</div>;
};
