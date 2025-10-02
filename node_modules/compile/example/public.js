
function Public() {
  this.readOnly = true
}

Public.add = function(a, b) {
  return a + b
}

Public.prototype.get = function(prop) {
  return this.store[prop]
}

module.exports = Public
