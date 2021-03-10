module.exports = class SessionState {
  constructor (references) {
    this.references = references
    this.ddatabases = new Map()
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

  deleteResource (id) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    res.dealloc()
    this.resources.delete(id)
  }

  hasBase (id) {
    return this.ddatabases.has(id)
  }

  addBase (id, base, isWeak) {
    if (this.ddatabases.has(id)) throw new Error('dDatabase already exists in session: ' + id)
    if (!isWeak) this.references.increment(base)
    this.ddatabases.set(id, { base, isWeak })
  }

  getBase (id) {
    if (!this.ddatabases.has(id)) throw new Error('Invalid ddatabase: ' + id)
    const { base } = this.ddatabases.get(id)
    return base
  }

  deleteBase (id) {
    if (!this.ddatabases.has(id)) throw new Error('Invalid ddatabase: ' + id)
    const { base, isWeak } = this.ddatabases.get(id)
    if (!isWeak) this.references.decrement(base)
    this.ddatabases.delete(id)
  }

  deleteAll () {
    for (const id of this.ddatabases.keys()) {
      this.deleteBase(id)
    }
    for (const { dealloc } of this.resources.values()) {
      dealloc()
    }
    this.resources.clear()
  }
}
