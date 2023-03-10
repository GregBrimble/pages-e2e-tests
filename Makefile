features := next-pages-experimental-edge-api-route

build-output-directory := .vercel/output/static

build:
	npx @cloudflare/next-on-pages


features:
	@echo $(features)

pages-e2e-test-build-command: build
	@cp -r $(build-output-directory) pages-e2e-test-build-output-directory
