const { intoPeer } = require('../common')

module.exports = class BasestoreSession {
  constructor (client, sessionState, basestore) {
    this._client = client
    this._basestore = basestore
    this._sessionState = sessionState

    const feedListener = (feed) => {
      this._client.basestore.onFeedNoReply({
        key: feed.key
      })
    }
    this._basestore.on('feed', feedListener)
    this._sessionState.addResource('@ddatabase/feed', null, () => {
      this._basestore.removeListener('feed', feedListener)
    })
  }

  // RPC Methods

  async open ({ id, key, name, weak }) {
    if (this._sessionState.hasBase(id)) throw new Error('Session already in use.')

    const base = this._basestore.get({ key, _name: name, default: !!name })
    this._sessionState.addBase(id, base, weak)

    // TODO: Delete session if ready fails.
    await new Promise((resolve, reject) => {
      base.ready(err => {
        if (err) return reject(err)
        return resolve()
      })
    })

    const appendListener = () => {
      this._client.ddatabase.onAppendNoReply({
        id,
        length: base.length,
        byteLength: base.byteLength
      })
    }
    base.on('append', appendListener)
    this._sessionState.addResource('@ddatabase/append-' + id, null, () => {
      base.removeListener('append', appendListener)
    })

    const peerOpenListener = (peer) => {
      this._client.ddatabase.onPeerOpenNoReply({
        id,
        peer: intoPeer(peer)
      })
    }
    base.on('peer-open', peerOpenListener)
    this._sessionState.addResource('@ddatabase/peer-open-' + id, null, () => {
      base.removeListener('peer-open', peerOpenListener)
    })

    const peerRemoveListener = (peer) => {
      this._client.ddatabase.onPeerRemoveNoReply({
        id,
        peer: intoPeer(peer)
      })
    }
    base.on('peer-remove', peerRemoveListener)
    this._sessionState.addResource('@ddatabase/peer-remove-' + id, null, () => {
      base.removeListener('peer-remove', peerRemoveListener)
    })

    if (weak) {
      const closeListener = () => {
        this._client.ddatabase.onCloseNoReply({ id })
      }
      base.on('close', closeListener)
      this._sessionState.addResource('@ddatabase/close-' + id, null, () => {
        base.removeListener('close', closeListener)
      })
    }

    return {
      key: base.key,
      length: base.length,
      byteLength: base.byteLength,
      writable: base.writable,
      peers: base.peers.map(intoPeer)
    }
  }
}
