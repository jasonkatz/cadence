PREFIX ?= /usr/local

.PHONY: build build-cli build-daemon build-client install clean test release

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

install: build
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 cli/target/release/tmpo $(DESTDIR)$(PREFIX)/bin/tmpo
	install -m 755 dist/tmpod $(DESTDIR)$(PREFIX)/bin/tmpod
	install -d $(HOME)/.tmpo/bin
	install -m 755 dist/tmpod $(HOME)/.tmpo/bin/tmpod

release: build-cli build-daemon
	@echo "Built release binaries:"
	@ls -lh cli/target/release/tmpo dist/tmpod

clean:
	rm -rf dist
	rm -rf server/public
	rm -f server/tmpod
	cd cli && cargo clean

test:
	cd server && bun test
	cd cli && cargo test
