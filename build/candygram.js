// Candygram is a Tangram-specific Browserify plugin
// It stringifies the library code into a variable that is immediately eval'ed,
// that can then be reused when Tangram instantiates is worker threads.

var through = require('through2');
var execSync = require('child_process').execSync;
var jsesc = require('jsesc');
var uglify = require("uglify-js");
var fs = require('fs');

// export a Browserify plugin
module.exports = function (browserify, opts) {
    //  create a transform stream
    var createStream = function () {
        var code = '';
        var stream = through.obj(function (buf, enc, next) {
            // accumulate the code chunks
            code += buf.toString();
            next();
        }, function (next) {
            // transform the code when accumulated
            if (opts.minify) { // optionally minify the code first
                code = uglify.minify(code, { fromString: true }).code;
            }

            // escape the code with single quotes
            code = jsesc(code, { quotes: 'single', wrap: true });

            // save it to a variable and eval, then save to internal Tangram property for later access
            code = '(function(){ var _TangramSource = ' + code + ';\n';
            code += 'eval(_TangramSource);\n';
            code += 'var target = (typeof module !== "undefined" && module.exports) || (typeof window !== "undefined" && window.Tangram);\n';
            code += 'if (target && target.source) { target.source._source = _TangramSource; };\n';
            code += '})();';

            this.push(new Buffer(code));
            next();
        });
        return stream;
    };

    // hook into the bundle generation pipeline of Browserify
    browserify.pipeline.get("wrap").push(createStream());
    browserify.on("reset", function () {
        browserify.pipeline.get("wrap").push(createStream());
    });
};
