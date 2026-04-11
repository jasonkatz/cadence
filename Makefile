.PHONY: build build-cli build-daemon build-client install clean test

build: build-cli build-daemon

build-cli:
	cd cli && cargo build --release

build-client:
	cd client && bun run build

build-daemon: build-client
	mkdir -p server/public
	cp -r client/dist/* server/public/
	cd server && bun run build:binary
	mkdir -p dist
	mv server/tmpod dist/tmpod

install:
	mkdir -p $(HOME)/.tmpo/bin
	cp dist/tmpod $(HOME)/.tmpo/bin/tmpod
	cargo install --path cli

clean:
	rm -rf dist
	rm -rf server/public
	rm -f server/tmpod
	cd cli && cargo clean

test:
	cd server && bun test
	cd cli && cargo test
