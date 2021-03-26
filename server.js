const path = require('path')
const os = require('os')

const Basestore = require('basestorex')
const Networker = require('@basestore/networker')
const DDatabaseCache = require('@ddatabase/cache')
const DDatabaseProtocol = require('@ddatabase/protocol')
const ddatabaseStorage = require('@ddatabase/default-storage')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const DWRPC = require('@dhub/rpc')
const getNetworkOptions = require('@dhub/rpc/socket')

const DHubDb = require('./lib/db')
const SessionState = require('./lib/session-state')
const BasestoreSession = require('./lib/sessions/basestore')
const DDatabaseSession = require('./lib/sessions/ddatabase')
const NetworkSession = require('./lib/sessions/network')
const startTrieExtension = require('./extensions/trie')

const TOTAL_CACHE_SIZE = 1024 * 1024 * 512
const CACHE_RATIO = 0.5
const TREE_CACHE_SIZE = TOTAL_CACHE_SIZE * CACHE_RATIO
const DATA_CACHE_SIZE = TOTAL_CACHE_SIZE * (1 - CACHE_RATIO)

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.dhub', 'storage')
const MAX_PEERS = 256
const SWARM_PORT = 49737
const NAMESPACE = '@ddatabase/protocol/dhub'

module.exports = class DHub extends Nanoresource {
  constructor (opts = {}) {
    super()

    var storage = opts.storage || DEFAULT_STORAGE_DIR
    if (typeof storage === 'string') {
      const storagePath = storage
      storage = p => ddatabaseStorage(path.join(storagePath, p))
    }

    const basestoreOpts = {
      storage,
      cacheSize: opts.cacheSize,
      sparse: opts.sparse !== false,
      // Collect networking statistics.
      stats: true,
      cache: {
        data: new DDatabaseCache({
          maxByteSize: DATA_CACHE_SIZE,
          estimateSize: val => val.length
        }),
        tree: new DDatabaseCache({
          maxByteSize: TREE_CACHE_SIZE,
          estimateSize: val => 40
        })
      },
      ifAvailable: true
    }
    this.basestore = new Basestore(basestoreOpts.storage, basestoreOpts)
    startTrieExtension(this.basestore)

    this.server = DWRPC.createServer(opts.server, this._onConnection.bind(this))
    this.db = new DHubDb(this.basestore)
    this.networker = null

    this.noAnnounce = !!opts.noAnnounce

    this._networkOpts = {
      announceLocalNetwork: true,
      preferredPort: SWARM_PORT,
      maxPeers: MAX_PEERS,
      ...opts.network
    }
    this._socketOpts = getNetworkOptions(opts)
    this._networkState = new Map()
  }

  // Nanoresource Methods

  async _open () {
    await this.basestore.ready()
    await this.db.open()

    // Note: This API is not exposed anymore -- this is a temporary fix.
    const seed = this.basestore.inner._deriveSecret(NAMESPACE, 'replication-keypair')
    const swarmId = this.basestore.inner._deriveSecret(NAMESPACE, 'swarm-id')
    this.networker = new Networker(this.basestore, {
      keyPair: DDatabaseProtocol.keyPair(seed),
      id: swarmId,
      ...this._networkOpts
    })
    await this.networker.listen()

    this._registerBaseTimeouts()
    await this._rejoin()

    await this.server.listen(this._socketOpts)
  }

  async _close () {
    await this.server.close()
    await this.networker.close()
    await this.db.close()
    await new Promise((resolve, reject) => {
      this.basestore.close(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  // Public Methods

  ready () {
    return this.open()
  }

  // Private Methods

  async _rejoin () {
    if (this.noAnnounce) return
    const networkConfigurations = await this.db.listNetworkConfigurations()
    for (const config of networkConfigurations) {
      if (!config.announce) continue
      const joinProm = this.networker.configure(config.discoveryKey, {
        announce: config.announce,
        lookup: config.lookup,
        // remember/discoveryKey are passed so that they will be saved in the networker's internal configurations list.
        remember: true,
        discoveryKey: config.discoveryKey
      })
      joinProm.catch(err => this.emit('swarm-error', err))
    }
  }

  /**
   * This is where we define our main heuristic for allowing ddatabase gets/updates to proceed.
   */
  _registerBaseTimeouts () {
    const flushSets = new Map()

    this.networker.on('flushed', dkey => {
      const keyString = dkey.toString('hex')
      if (!flushSets.has(keyString)) return
      const { flushSet, peerAddSet } = flushSets.get(keyString)
      callAllInSet(flushSet)
      callAllInSet(peerAddSet)
    })

    this.basestore.on('feed', base => {
      const discoveryKey = base.discoveryKey
      const peerAddSet = new Set()
      const flushSet = new Set()
      var globalFlushed = false

      if (!this.networker.swarm || this.networker.swarm.destroyed) return
      this.networker.swarm.flush(() => {
        if (this.networker.joined(discoveryKey)) return
        globalFlushed = true
        callAllInSet(flushSet)
        callAllInSet(peerAddSet)
      })

      flushSets.set(discoveryKey.toString('hex'), { flushSet, peerAddSet })
      base.once('peer-add', () => {
        callAllInSet(peerAddSet)
      })

      const timeouts = {
        get: (cb) => {
          if (this.networker.joined(discoveryKey)) {
            if (this.networker.flushed(discoveryKey)) return cb()
            return flushSet.add(cb)
          }
          if (globalFlushed) return cb()
          return flushSet.add(cb)
        },
        update: (cb) => {
          const oldCb = cb
          cb = (...args) => {
            oldCb(...args)
          }
          if (base.peers.length) return cb()
          if (this.networker.joined(discoveryKey)) {
            if (this.networker.flushed(discoveryKey) && !base.peers.length) return cb()
            return peerAddSet.add(cb)
          }
          if (globalFlushed) return cb()
          return peerAddSet.add(cb)
        }
      }
      base.timeouts = timeouts
    })
  }

  _onConnection (client) {
    const sessionState = new SessionState(this.basestore)

    this.emit('client-open', client)

    client.on('close', () => {
      sessionState.deleteAll()
      this.emit('client-close', client)
    })

    client.dhub.onRequest(this)
    client.basestore.onRequest(new BasestoreSession(client, sessionState, this.basestore))
    client.ddatabase.onRequest(new DDatabaseSession(client, sessionState))
    client.network.onRequest(new NetworkSession(client, sessionState, this.basestore, this.networker, this.db, this._networkState, {
      noAnnounce: this.noAnnounce
    }))
  }

  // Top-level RPC Methods

  status () {
    const swarm = this.networker && this.networker.swarm
    const remoteAddress = swarm && swarm.remoteAddress()
    const holepunchable = swarm && swarm.holepunchable()
    return {
      version: require('./package.json').version,
      apiVersion: require('@dhub/rpc/package.json').version,
      holepunchable: holepunchable,
      remoteAddress: remoteAddress ? remoteAddress.host + ':' + remoteAddress.port : ''
    }
  }

  stop () {
    return this.close()
  }
}

function callAllInSet (set) {
  for (const cb of set) {
    cb()
  }
  set.clear()
}
