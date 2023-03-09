

features:
	@echo $(features)

pages-e2e-test-build-command: build
	@cp -r $(build-output-directory) pages-e2e-test-build-output-directory
