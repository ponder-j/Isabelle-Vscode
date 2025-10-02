
Compiled
========

[![Build Status](https://secure.travis-ci.org/sorensen/compiled.png)](http://travis-ci.org/sorensen/compiled) 

Class / function composition library, combines all static and prototype methods
into a single function, constructors are also chained and will be ran in the 
order they are received. A `strict` option can be set for the library which will
throw an error if property colision is encountered.

This library can be used with both node and the browser, file based methods are
only available in node, such as `compile.dir`.


Usage
-----

Node.js

``` js
var compile = require('compile')
```

Browser

``` html
<script src="compile.min.js"></script>
```


Methods
-------

### compile(…)

Combines any number of functions passed into a single function

``` js
function Red() { this.bar = 1 }
function Blue() { this.foo = 2 }

var Purple = compile(Red, Blue)
var purp = new Purple()

purp.bar // 1
purp.foo // 2
```

### compile.setup(options)

Configure the library, currently only the `strict` option is used, which will 
throw an error if a property colision is found.

``` js
compile.setup({ strict: true })
```

### compile.dir(directory, [exclude])

Combines all exports for a given directory into a single function, `directory`
should be the absolute path, `exclude` can be an array of filenames or a single
file to exclude from the compile. Pathing can be relative or absolute for `exclude`.

``` js
module.exports = compile.dir(__dirname, __filename)
```


Install
-------

With [npm](https://npmjs.org)

```
npm install compile
```


License
-------

(The MIT License)

Copyright (c) 2011-2012 Beau Sorensen <mail@beausorensen.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
