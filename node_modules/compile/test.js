'use strict';

var assert = require('assert')
  , ase = assert.strictEqual
  , compile = require('./index')
  , example = require('./example')
  , API = example.API

describe('compile', function() {
  it('should create a new class', function() {
    var Platypus = example.animal
      , sally = new Platypus()

    ase(sally.bird, true)
    ase(sally.mammal, true)
    ase(sally.tail(), 'slap')
    ase(sally.beak(), 'quack')
  })

  it('should call each constructor', function(next) {
    var len = 4
    function callback() {
      --len || next()
    }
    function one() {
      callback()
    }
    function two() {
      callback()
    }
    var three = compile(one, two)
    three()
    var hi = new three()
  })
})

describe('compile.dir', function() {
  it('should create a new class from directory', function() {
    var api = new API()

    ase(API.add(1, 2), 3)
    ase(api.set('foo', 1), 1)
    ase(api.get('foo'), 1)
    ase(API.setup(), 'static')
  })
})
