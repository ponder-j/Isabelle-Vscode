
function Internal() {
  this.writeOnly = true
  this.store = {}
}

Internal.setup = function() {
  return 'static'
}

Internal.prototype.set = function(prop, val) {
  return this.store[prop] = val
}

module.exports = Internal
