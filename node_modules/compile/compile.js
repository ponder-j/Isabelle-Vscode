/**
 * (c) 2012 Beau Sorensen
 * MIT Licensed
 * For all details and documentation:
 * https://github.com/sorensen/defined-args
 */

;(function() {
'use strict';

/*!
 * Module dependencies.
 */

var root = this
  , slice = Array.prototype.slice
  , toString = Object.prototype.toString
  , options = {strict: false}

/*!
 * Module dependencies.
 */

var slice = Array.prototype.slice
  , toString = Object.prototype.toString
  , fs = require('fs')
  , path = require('path')
  , options = {strict: false}

/** 
 * Extend a given object with any number of sources
 *
 * @param {Object} obj to extend
 * @param {...} source objects
 * @returns {Object} extended obj
 */

function extend(obj) {
  var args = slice.call(arguments, 1)
  for (var i = 0; i < args.length; i++) {
    var source = args[i]
    if (!source) continue
    for (var prop in source) {
      if (!source.hasOwnProperty(prop)) continue
      if (options.strict && obj[prop]) {
        throw new Error('Method conflict found `' + prop + '`')
      }
      obj[prop] = source[prop]
    }
  }
  return obj
}

/**
 * Combine objects into a single prototype chain as well
 * as constructor chain, constructors will be called in
 * the order they are received
 *
 * Example:
 *
 *   var Platypus = compile(Duck, Beaver)
 *
 * @param {...} Objects to combine
 * @returns {Object} combined result
 */

function compile() {
  var args = slice.call(arguments, 0)
    , proto = {}

  // Create a new object constructor that will apply
  // the constructors of all supplied objects
  var ctor = function() {
    for (var i = 0; i !== args.length; i++) {
      args[i].apply(this, arguments)
    }
    return this
  }
  // Add all static properties to the constructor, then add
  // all prototype properties to the temp placeholder
  for (var i = 0; i !== args.length; i++) {
    extend(ctor, args[i])
    extend(proto, args[i].prototype)
  }
  // Create a new object with the correct constructor and
  // combined prototype chain to use for the final constructor
  function Surrogate() { this.constructor = ctor }
  Surrogate.prototype = proto
  ctor.prototype = new Surrogate()
  return ctor
}

/**
 * Configure module
 *
 * @param {Object} options hash
 */

compile.config = function(source) {
  extend(options, source)
}

/*!
 * Module exports.
 */

if (typeof exports !== 'undefined') {
  module.exports = compile
} else {
  root.compile = compile
}

}).call(this);
