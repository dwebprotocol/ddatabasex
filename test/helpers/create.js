const tmp = require('tmp-promise')
const dht = require('@dswarm/dht')
const DHubClient = require('../../client')
const DHubServer = require('../../server')

const BOOTSTRAP_PORT = 3106
const BOOTSTRAP_URL = `localhost:${BOOTSTRAP_PORT}`

async function createOne (opts = {}) {
  const tmpDir = opts.dir || await tmp.dir({ unsafeCleanup: true })
  const server = new DHubServer({ ...opts, storage: tmpDir.path, network: { bootstrap: opts.bootstrap || false } })
  await server.ready()

  const client = new DHubClient({ host: opts.host })
  await client.ready()

  const cleanup = async () => {
    await client.close()
    await server.close()
    await tmpDir.cleanup()
  }

  return { server, client, cleanup, dir: tmpDir }
}

async function createMany (numDaemons, opts) {
  const cleanups = []
  const clients = []
  const servers = []
  const dirs = []

  const bootstrapOpt = [BOOTSTRAP_URL]
  const bootstrapper = dht({
    bootstrap: false
  })
  bootstrapper.listen(BOOTSTRAP_PORT)
  await new Promise(resolve => {
    return bootstrapper.once('listening', resolve)
  })

  for (let i = 0; i < numDaemons; i++) {
    const serverOpts = opts ? Array.isArray(opts) ? opts[i] : opts : null
    const { server, client, cleanup, dir } = await createOne({ ...serverOpts, bootstrap: bootstrapOpt, host: 'dhub-' + i })
    cleanups.push(cleanup)
    servers.push(server)
    clients.push(client)
    dirs.push(dir)
  }

  return { clients, servers, cleanup, dirs, bootstrapOpt }

  async function cleanup (opts) {
    for (const cleanupInstance of cleanups) {
      await cleanupInstance(opts)
    }
    await bootstrapper.destroy()
  }
}

module.exports = {
  createOne,
  createMany
}
