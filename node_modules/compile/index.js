/**
 * (c) 2012 Beau Sorensen
 * MIT Licensed
 * For all details and documentation:
 * https://github.com/sorensen/defined-args
 */

/*!
 * Module dependencies.
 */

var slice = Array.prototype.slice
  , toString = Object.prototype.toString
  , compile = require('./compile')
  , fs = require('fs')
  , path = require('path')

/**
 * Combine the results of a given directory to be used for
 * compiling into a single object
 *
 * Example:
 *
 *   var API = compile.dir(__dirname, __filename)
 *
 * @param {String} target directory (example: `__dirname`)
 * @param {String} file to exclude (example: `index.js`)
 * @returns {Object} compile result
 */

compile.dir = function(directory, exclude) {
  var files = fs.readdirSync(directory)
    , args = [], file, full, obj

  // Ensure array of excludes
  exclude = toString.call(exclude) === '[object Array]'
    ? exclude
    : [exclude]

  // Iterate through each file found
  for (var i = 0; i !== files.length; i++) {
    file = files[i]
    full = path.join(directory, file)

    // Check for excluded filename
    if (!!~exclude.indexOf(file) || !!~exclude.indexOf(full)) continue
    // Add to arg list if any export was found
    obj = require(full)
    obj && args.push(obj)
  }
  // Compile all found objects
  return compile.apply(null, args)
}

/*!
 * Module exports.
 */

module.exports = compile
