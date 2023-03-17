features := functions-date

build-output-directory := build

setup:
	npx create-react-app@latest my-react-app
	cp -r my-react-app/ .
	rm -rf my-react-app

build:
	npm run build


features:
	@echo $(features)

pages-e2e-test-build-command: build
	@cp -r $(build-output-directory) pages-e2e-test-build-output-directory
