export const onRequestGet: PagesFunction = () =>
	new Response(new Date().toISOString());
