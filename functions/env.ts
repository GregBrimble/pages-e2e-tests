/// <reference types="@cloudflare/workers-types" />

export const onRequest: PagesFunction = ({ env }) => {
	return new Response(JSON.stringify({ env }), {
		headers: { "Content-Type": "application/json" },
	});
};
