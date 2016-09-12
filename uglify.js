'use strict';

const uglifyJs = require('uglify-js')

process.on('message', (data) => {
  process.send(uglifyJs.minify(data, {
    fromString: true,
    mangle: true,
    compress: {
      sequences: true,
      dead_code: true,
      conditionals: true,
      booleans: true,
      unused: true,
      if_return: true,
      join_vars: true,
      drop_console: true,
    },
    output: {
      beautify: false,
      space_colon: false,
      semicolons: false,
      indent_level: 0,
    }
  }).code, () => process.exit(0))
})
