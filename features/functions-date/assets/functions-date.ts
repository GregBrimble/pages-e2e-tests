/// <reference types="@cloudflare/workers-types" />

export const onRequestGet: PagesFunction = () =>
	new Response(new Date().toISOString());
