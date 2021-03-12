#!/usr/bin/env node
const p = require('path')
const os = require('os')
const fs = require('fs').promises
const repl = require('repl')
const minimist = require('minimist')

const { Server, Client } = require('../')
const { migrate: migrateFromDaemon, isMigrated } = ('@dhub/migration-tool')

// TODO: Default paths are duplicated here because we need to do the async migration check.
const DHUB_STORAGE_DIR = p.join(os.homedir(), '.dhub', 'storage')
const DDRIVE_STORAGE_DIR = p.join(os.homedir(), '.ddrive', 'storage', 'bases')

const argv = minimist(process.argv.slice(2), {
  string: ['host', 'storage', 'bootstrap'],
  boolean: ['memory-only', 'announce', 'migrate', 'repl'],
  default: {
    announce: true,
    migrate: true
  },
  alias: {
    host: 'h',
    storage: 's',
    bootstrap: 'b'
  }
})

const version = `dhub/${require('../package.json').version} ${process.platform}-${process.arch} node-${process.version}`

const help = `DDatabase, batteries included.
${version}

Usage: dhub [options]

  --host,      -h  Set unix socket name
  --port       -p  Set the port (will use TCP)
  --storage,   -s  Overwrite storage folder
  --bootstrap, -b  Overwrite DHT bootstrap servers
  --memory-only    Run all storage in memory
  --no-announce    Disable all network annoucnes
  --repl           Run a debug repl
  --no-migrate     Disable the dDrive Daemon migration
`

if (argv.help) {
  console.error(help)
  process.exit(0)
}

main().catch(onerror)

async function main () {
  console.log('Running ' + version)

  // Note: This will be removed in future releases of dHub.
  // If the ddrive-daemon -> dhub migration has already completed, this is a no-op.
  if (argv.migrate) {
    if (!(await isMigrated({ noMove: true }))) {
      console.log('Migrating from DDrive daemon...')
      // TODO: For dBrowser compat, do not move existing bases into ~/.dhub for now.
      await migrateFromDaemon({ noMove: true })
      console.log('Migration finished.')
    }
  }

  // For now, the storage path is determined as follows:
  // If ~/.ddrive/storage/bases exists, use that (from an old ddrive daemon installation)
  // Else, use ~/.dhub/storage
  const storage = argv.storage ? argv.storage : await getStoragePath()

  const s = new Server({
    host: argv.host,
    port: argv.port,
    storage,
    network: argv.bootstrap ? { bootstrap: [].concat(argv.bootstrap) } : null,
    noAnnounce: !argv.announce,
    noMigrate: !argv.migrate
  })
  global.dhub = s

  if (!argv.repl) {
    s.on('client-open', () => {
      console.log('Remote client opened')
    })

    s.on('client-close', () => {
      console.log('Remote client closed')
    })
  } else {
    const r = repl.start({
      useGlobal: true
    })
    r.context.server = s
  }

  process.once('SIGINT', close)
  process.once('SIGTERM', close)

  try {
    await s.open()
  } catch (err) {
    const c = new Client()
    let status

    try {
      status = await c.status()
    } catch (_) {}

    if (status) {
      console.log('Server is already running with the following status')
      console.log()
      console.log('API Version   : ' + status.apiVersion)
      console.log('Holepunchable : ' + status.holepunchable)
      console.log('Remote address: ' + status.remoteAddress)
      console.log()
      process.exit(1)
    } else {
      throw err
    }
  }

  const socketOpts = s._socketOpts
  if (socketOpts.port) {
    console.log(`Listening on ${socketOpts.host || 'localhost'}:${socketOpts.port}`)
  } else {
    console.log(`Listening on ${socketOpts}`)
  }

  function close () {
    console.log('Shutting down...')
    s.close().catch(onerror)
  }
}

async function getStoragePath () {
  try {
    // If this dir exists, use it.
    await fs.stat(DDRIVE_STORAGE_DIR)
    return DDRIVE_STORAGE_DIR
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return DHUB_STORAGE_DIR
  }
}

function onerror (err) {
  console.error(err.stack)
  process.exit(1)
}
