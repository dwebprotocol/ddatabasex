const LOCK = Symbol('ddatabase lock')

module.exports = class DDatabaseSession {
  constructor (client, sessionState) {
    this._client = client
    this._sessionState = sessionState
    this._downloads = new Map()
  }

  // RPC Methods

  close ({ id }) {
    this._sessionState.deleteBase(id)
    this._sessionState.deleteResource('@ddatabase/append-' + id)
    this._sessionState.deleteResource('@ddatabase/peer-open-' + id)
    this._sessionState.deleteResource('@ddatabase/peer-remove-' + id)
    if (this._sessionState.hasResource('@ddatabase/close-' + id)) {
      this._sessionState.deleteResource('@ddatabase/close-' + id)
    }
    if (this._sessionState.hasResource('@ddatabase/download-' + id)) {
      this._sessionState.deleteResource('@ddatabase/download-' + id)
    }
    if (this._sessionState.hasResource('@ddatabase/upload-' + id)) {
      this._sessionState.deleteResource('@ddatabase/upload-' + id)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    for (const resourceId of downloadSet) {
      this._sessionState.deleteResource(resourceId)
    }
    this._downloads.delete(id)
  }

  async get ({ id, resourceId, seq, wait, ifAvailable, onWaitId }) {
    const base = this._sessionState.getBase(id)
    const onwait = onWaitId ? seq => this._client.ddatabase.onWaitNoReply({ id, onWaitId, seq }) : null

    return new Promise((resolve, reject) => {
      const get = base.get(seq, { wait, ifAvailable, onwait }, (err, block) => {
        if (this._sessionState.hasResource(resourceId)) this._sessionState.deleteResource(resourceId, true)
        if (err) return reject(err)
        return resolve({ block })
      })
      this._sessionState.addResource(resourceId, get, () => base.cancel(get))
    })
  }

  cancel ({ id, resourceId }) {
    this._sessionState.getBase(id) // make sure it exists
    if (this._sessionState.hasResource(resourceId)) {
      this._sessionState.deleteResource(resourceId)
    }
  }

  async append ({ id, blocks }) {
    const base = this._sessionState.getBase(id)
    return new Promise((resolve, reject) => {
      base.append(blocks, (err, seq) => {
        if (err) return reject(err)
        return resolve({
          length: base.length,
          byteLength: base.byteLength,
          seq
        })
      })
    })
  }

  async update ({ id, ifAvailable, minLength, hash }) {
    const base = this._sessionState.getBase(id)
    return new Promise((resolve, reject) => {
      base.update({ ifAvailable, minLength, hash }, (err, block) => {
        if (err) return reject(err)
        return resolve({ block })
      })
    })
  }

  async seek ({ id, byteOffset, start, end, wait, ifAvailable }) {
    const base = this._sessionState.getBase(id)
    return new Promise((resolve, reject) => {
      base.seek(byteOffset, { start, end, wait, ifAvailable }, (err, seq, blockOffset) => {
        if (err) return reject(err)
        return resolve({ seq, blockOffset })
      })
    })
  }

  async has ({ id, seq }) {
    const base = this._sessionState.getBase(id)
    return new Promise((resolve, reject) => {
      base.ready(err => {
        if (err) return reject(err)
        return resolve({
          has: base.has(seq)
        })
      })
    })
  }

  async download ({ id, resourceId, start, end, blocks, linear, live }) {
    const base = this._sessionState.getBase(id)
    const opts = { start, end: live ? -1 : end, blocks: blocks.length ? blocks : null, linear }
    return new Promise((resolve, reject) => {
      let downloaded = false
      const d = base.download(opts, (err) => {
        downloaded = true
        if (this._sessionState.hasResource(resourceId)) {
          this._sessionState.deleteResource(resourceId)
        }
        if (err) return reject(err)
        return resolve()
      })
      if (downloaded) return
      this._sessionState.addResource(resourceId, d, () => {
        base.undownload(d)
      })
      let downloadSet = this._downloads.get(id)
      if (!downloadSet) {
        downloadSet = new Set()
        this._downloads.set(id, downloadSet)
      }
      downloadSet.add(resourceId)
    })
  }

  undownload ({ id, resourceId }) {
    // Loading the base just in case it's an invalid ID (it should throw in that case).
    this._sessionState.getBase(id)
    if (this._sessionState.hasResource(resourceId)) {
      this._sessionState.deleteResource(resourceId)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    downloadSet.delete(resourceId)
    if (!downloadSet.size) this._downloads.delete(id)
  }

  registerExtension ({ id, resourceId, name }) {
    const base = this._sessionState.getBase(id)
    const client = this._client

    base.extensions.exclusive = false

    const ext = base.registerExtension(name, {
      onmessage (data, from) {
        client.ddatabase.onExtensionNoReply({
          id: id,
          resourceId,
          remotePublicKey: from.remotePublicKey,
          data
        })
      }
    })

    this._sessionState.addResource(resourceId, ext, () => ext.destroy())
  }

  unregisterExtension ({ resourceId }) {
    this._sessionState.deleteResource(resourceId)
  }

  sendExtension ({ id, resourceId, remotePublicKey, data }) {
    const base = this._sessionState.getBase(id)
    const ext = this._sessionState.getResource(resourceId)

    if (!remotePublicKey) {
      ext.broadcast(data)
      return
    }

    for (const peer of base.peers) {
      if (peer.remotePublicKey && peer.remotePublicKey.equals(remotePublicKey)) {
        ext.send(data, peer)
      }
    }
  }

  downloaded ({ id, start, end }) {
    const base = this._sessionState.getBase(id)
    const bytes = base.downloaded(start, end)
    return { bytes }
  }

  async acquireLock ({ id }) {
    const base = this._sessionState.getBase(id)

    while (true) {
      const lock = base[LOCK]
      if (!lock) break
      await lock.promise
    }

    const lock = base[LOCK] = {
      promise: null,
      resolve: null,
      session: this
    }

    lock.promise = new Promise((resolve, reject) => {
      lock.resolve = resolve
    })

    this._sessionState.addResource(LOCK, null, () => lock.resolve())
  }

  releaseLock ({ id }) {
    const base = this._sessionState.getBase(id)
    const lock = base[LOCK]

    if (!lock) throw new Error('Core is not locked')
    if (lock.session !== this) throw new Error('Core is not locked by you')

    base[LOCK] = null
    this._sessionState.deleteResource(LOCK)
  }

  async watchDownloads ({ id }) {
    if (this._sessionState.hasResource('@ddatabase/download-' + id)) {
      return
    }
    const base = this._sessionState.getBase(id)
    const downloadListener = (seq, data) => {
      this._client.ddatabase.onDownloadNoReply({
        id,
        seq,
        byteLength: data.length
      })
    }
    base.on('download', downloadListener)
    this._sessionState.addResource('@ddatabase/download-' + id, null, () => {
      base.removeListener('download', downloadListener)
    })
  }

  async unwatchDownloads ({ id }) {
    if (this._sessionState.hasResource('@ddatabase/download-' + id)) {
      this._sessionState.deleteResource('@ddatabase/download-' + id)
    }
  }

  async watchUploads ({ id }) {
    if (this._sessionState.hasResource('@ddatabase/upload-' + id)) {
      return
    }
    const base = this._sessionState.getBase(id)
    const uploadListener = (seq, data) => {
      this._client.ddatabase.onUploadNoReply({
        id,
        seq,
        byteLength: data.length
      })
    }
    base.on('upload', uploadListener)
    this._sessionState.addResource('@ddatabase/upload-' + id, null, () => {
      base.removeListener('upload', uploadListener)
    })
  }

  async unwatchUploads ({ id }) {
    if (this._sessionState.hasResource('@ddatabase/upload-' + id)) {
      this._sessionState.deleteResource('@ddatabase/upload-' + id)
    }
  }
}
