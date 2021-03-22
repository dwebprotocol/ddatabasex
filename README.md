# dhub
[![Build Status](https://travis-ci.com/andrewosh/dhub.svg?token=WgJmQm3Kc6qzq1pzYrkx&branch=master)](https://travis-ci.com/andrewosh/dhub)

> DDatabases, batteries included.

Hyperspace is a lightweight server that provides remote access to DDatabases and a Hyperswarm instance. It exposes a simple [RPC interface](https://github.com/dwebprotocol/rpc) that can be accessed with the [Hyperspace client for Node.js](https://github.com/dwebprotocol/client).

The RPC API's designed to be minimal, maintaining parity with DDatabase and the [`@basestorex/networker`](https://github.com/andrewosh/basestore-networker) but with few extras.

Features include:
* A `RemoteCorestore` interface for creating namespaced [`Basestore`](https://github.com/andrewosh/basestore) instances. 
* A `RemoteNetworker` interface for managing [Hyperswarm DHT](https://github.com/dswarm/dswarm) connections. Supports stream-level extensions. 
* A `RemoteHypercore` interface that feels exactly like normal ol' [`DDatabase`](https://github.com/ddatabse-protocol/ddatabse), with [few exceptions](TODO). Extensions included.

#### Already using the dDrive daemon?
With Hyperspace, most of the [dDrive daemon's](https://github.com/ddatabse-protocol/ddrive-daemon) functionality has been moved into "userland" -- instead of providing remote access to Hyperdrives, the regular [`ddrive`](https://github.com/ddatabse-protocol/ddrive) module can be used with remote DDatabases.

If you're currently using the dDrive daemon with FUSE and/or the daemon CLI, take a look at the upgrade instructions in [`@dhub/ddrive`](https://github.com/dwebprotocol/ddrive-service), which is our new Hyperdrive companion service for handling FUSE/CLI alongside Hyperspace.

__Note: The first time you run Hyperspace, it will detect your old dDrive daemon installation and do an automatic migration. You can postpone the migration by starting the server with the `--no-migrate` flag (`dhub --no-migrate`).__

### Installation
```
npm i dhub -g
```

### Getting Started
When installed globally, you can use the `dhub` CLI tool to start the server:
```
❯ dhub --no-migrate  // Starts the server without performing the dDrive daemon migration
```

The `dhub` command supports the following flags:
```
--bootstrap   // Hyperswarm bootstrapping options (see Hyperswarm docs).
--host        // Host to bind to.
--port        // Port to bind to (if specified, will use TCP).
--memory-only // Run in memory-only mode.
--no-announce // Never announce topics on the DHT.
--no-migrate  // Do not attempt to migrate the dDrive daemon's storage to Hyperspace.
--repl        // Start the server with a debugging REPL.
```

By default, Hyperspace binds to a UNIX domain socket (or named pipe on Windows) at `~/.dhub/dhub.sock`.

Once the server's started, you can use the client to create and manage remote DDatabases. If you'd like the use the Hyperdrive CLI, check out the [`@dhub/ddrive` docs](https://github.com/dwebprotocol/ddrive-service).

### API
To work with Hyperspace, you'll probably want to start with the [Node.js client library](https://github.com/dwebprotocol/client). The README over there provides detailed API info.

### Simulator

Hyperspace includes a "simulator" that can be used to create one-off Hyperspace instances, which can be used for testing.

```js
const simulator = require('dhub/simulator')
// client is a DHubClient, server is a DHubServer
const { client, server, cleanup } = await simulator()
```

### License
MIT
