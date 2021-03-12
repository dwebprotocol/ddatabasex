module.exports = class SessionState {
  constructor (basestore) {
    this.basestore = basestore
    this.ddatabses = new Map()
    this.resources = new Map()
  }

  addResource (id, value, dealloc) {
    const res = this.resources.get(id)
    if (res) {
      dealloc()
      throw new Error('Resource already exists: ' + id)
    }
    this.resources.set(id, {
      value,
      dealloc
    })
  }

  hasResource (id) {
    return this.resources.has(id)
  }

  getResource (id) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    return res.value
  }

  deleteResource (id, noDealloc) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    if (!noDealloc) res.dealloc()
    this.resources.delete(id)
  }

  hasBase (id) {
    return this.ddatabses.has(id)
  }

  addBase (id, base, isWeak) {
    if (this.ddatabses.has(id)) throw new Error('DDatabase already exists in session: ' + id)
    if (!isWeak) this.basestore.cache.increment(base.discoveryKey.toString('hex'))
    this.ddatabses.set(id, { base, isWeak })
  }

  getBase (id) {
    if (!this.ddatabses.has(id)) throw new Error('Invalid ddatabse: ' + id)
    const { base } = this.ddatabses.get(id)
    return base
  }

  deleteBase (id) {
    if (!this.ddatabses.has(id)) throw new Error('Invalid ddatabse: ' + id)
    const { base, isWeak } = this.ddatabses.get(id)
    if (!isWeak) this.basestore.cache.decrement(base.discoveryKey.toString('hex'))
    this.ddatabses.delete(id)
  }

  deleteAll () {
    for (const { dealloc } of this.resources.values()) {
      dealloc()
    }
    for (const id of this.ddatabses.keys()) {
      this.deleteBase(id)
    }
    this.resources.clear()
  }
}
